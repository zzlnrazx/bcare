import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
} from '@discordjs/voice';
import googleTTS from 'google-tts-api';

dns.setDefaultResultOrder('ipv4first');

const token = process.env.TOKEN?.trim();
const port = Number(process.env.PORT) || 10000;
const maxTextLength = 200;
const maxMessages = 5;
const spamWindowMs = 5_000;
const warningCooldownMs = 10_000;

if (!token) {
    console.error('TOKEN is missing. Add TOKEN to the service environment.');
    process.exit(1);
}

const app = express();
app.get('/', (_request, response) => response.send('Discord bot is running.'));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const guildPlayers = new Map();
const messageTimestamps = new Map();
const warningCooldowns = new Map();

function getPlayer(guildId) {
    let player = guildPlayers.get(guildId);
    if (!player) {
        player = createAudioPlayer({ behavior: NoSubscriberBehavior.Stop });
        player.on('error', error => console.error(`Audio error in guild ${guildId}:`, error.message));
        guildPlayers.set(guildId, player);
    }
    return player;
}

function getSpeechUrl(text) {
    return googleTTS.getAudioUrl(text.slice(0, maxTextLength), {
        lang: 'th',
        slow: false,
        host: 'https://translate.google.com',
    });
}

async function speak(guildId, text) {
    const connection = getVoiceConnection(guildId);
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return false;
    getPlayer(guildId).play(createAudioResource(getSpeechUrl(text)));
    return true;
}

client.once(Events.ClientReady, readyClient => {
    clearTimeout(gatewayTimeout);
    console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.Error, error => console.error('Discord client error:', error));
client.on(Events.ShardError, error => console.error('Discord gateway error:', error));

if (process.env.DEBUG === 'true') {
    client.on(Events.Debug, message => {
        console.log('Discord debug:', message.replace(/Provided token: .*?(?=$|\n)/, 'Provided token: [redacted]'));
    });
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.guildId) return;

    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ping') {
                await interaction.reply({ content: 'Pong!', ephemeral: true });
                return;
            }

            if (interaction.commandName === 'join') {
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    await interaction.reply('คุณต้องอยู่ในห้องเสียงก่อน');
                    return;
                }

                await interaction.deferReply();
                getVoiceConnection(interaction.guildId)?.destroy();
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guildId,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                });
                connection.subscribe(getPlayer(interaction.guildId));
                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                await interaction.editReply(`บอทเข้าห้อง ${voiceChannel.name} แล้ว`);
                return;
            }

            if (interaction.commandName === 'leave') {
                getVoiceConnection(interaction.guildId)?.destroy();
                await interaction.reply('บอทออกจากห้องเสียงแล้ว');
                return;
            }
        }

        if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'อ่านข้อความนี้') {
            await interaction.deferReply();
            const text = interaction.targetMessage?.content?.trim();
            if (!text) {
                await interaction.editReply('ข้อความนี้ไม่มีตัวหนังสือให้อ่าน');
            } else if (await speak(interaction.guildId, text)) {
                const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
                await interaction.editReply(`กำลังอ่าน: "${preview}"`);
            } else {
                await interaction.editReply('บอทยังไม่ได้อยู่ในห้องเสียง โปรดใช้ /join ก่อน');
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        const reply = 'เกิดข้อผิดพลาดในการทำงาน';
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply({ content: reply, ephemeral: true }).catch(() => {});
    }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
        getVoiceConnection(oldState.guild.id)?.destroy();
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild || !message.content.trim()) return;

    const now = Date.now();
    if (warningCooldowns.has(message.author.id)) return;
    const recent = (messageTimestamps.get(message.author.id) ?? [])
        .filter(timestamp => now - timestamp < spamWindowMs);
    recent.push(now);
    messageTimestamps.set(message.author.id, recent);

    if (recent.length > maxMessages) {
        await message.reply(`โปรดส่งข้อความช้าลง ${message.author}`);
        messageTimestamps.delete(message.author.id);
        warningCooldowns.set(message.author.id, true);
        setTimeout(() => warningCooldowns.delete(message.author.id), warningCooldownMs);
        return;
    }

    if (message.attachments.size === 0 && !/^https?:\/\//i.test(message.content)) {
        await speak(message.guild.id, message.content).catch(error => {
            console.error('Message TTS error:', error.message);
        });
    }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

const gatewayTimeout = setTimeout(() => {
    console.error('Discord Gateway connection timed out after 30 seconds.');
    console.error('The service can reach its HTTP port, but Discord Gateway did not respond.');
    client.destroy();
    process.exit(1);
}, 30_000);

client.login(token).catch(error => {
    console.error('Discord login failed:', error.message);
    process.exit(1);
});
