import dotenv from 'dotenv';
import express from 'express';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    getVoiceConnection, 
    createAudioPlayer, 
    createAudioResource,
    VoiceConnectionStatus,
    entersState
} from '@discordjs/voice';
import googleTTS from 'google-tts-api';

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

// -------------------------------------------------------------
// Express Web Server (สำหรับ Render 24/7)
// -------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running online 24/7!');
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// -------------------------------------------------------------
// Discord Client Configuration
// -------------------------------------------------------------
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

const guildPlayers = new Map();

function getOrCreatePlayer(guildId) {
    if (!guildPlayers.has(guildId)) {
        guildPlayers.set(guildId, createAudioPlayer());
    }
    return guildPlayers.get(guildId);
}

// Anti-Spam
const MAX_MESSAGES = 5; 
const PER_TIME_MS = 5000; 
const WARNING_COOLDOWN_MS = 10000; 

const SPAM_MAP = new Map();
const COOLDOWN_MAP = new Map(); 

client.on(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
});

// -------------------------------------------------------------
// Interaction Handlers (แก้ปัญหาแอปพลิเคชันไม่ตอบสนองด้วย deferReply)
// -------------------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const { commandName, guild, member } = interaction;
    const player = getOrCreatePlayer(guild.id);

    // --- คำสั่ง /ping ---
    if (commandName === 'ping') {
        return await interaction.reply({ content: 'Pong!', ephemeral: true });
    }

    // --- คำสั่ง /join ---
    if (commandName === 'join') {
        await interaction.deferReply({ ephemeral: false }); // ส่งสัญญาณบอก Discord ป้องกันการค้าง 3s

        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return await interaction.editReply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนสั่งให้บอทเข้า!' });
        }

        let connection = getVoiceConnection(guild.id);

        if (connection && 
            connection.joinConfig.channelId === voiceChannel.id && 
            connection.state.status !== VoiceConnectionStatus.Destroyed) {
            return await interaction.editReply({ content: 'ฉันอยู่ในห้องเสียงนี้อยู่แล้วครับ!' });
        }

        try {
            if (connection) {
                connection.destroy();
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    try { connection.destroy(); } catch (e) {}
                }
            });

            connection.subscribe(player);
            await interaction.editReply({ content: `🔊 บอทเข้าห้อง **${voiceChannel.name}** เรียบร้อยแล้ว!` });
        } catch (err) {
            console.error('Voice join failed:', err);
            await interaction.editReply({ content: 'ไม่สามารถเข้าร่วมช่องเสียงได้' });
        }
    } 
    
    // --- คำสั่ง /leave ---
    else if (commandName === 'leave') {
        await interaction.deferReply({ ephemeral: false });

        try {
            const connection = getVoiceConnection(guild.id);
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
                await interaction.editReply({ content: '👋 บอทออกจากห้องเสียงเรียบร้อยแล้ว!' });
            } else {
                await interaction.editReply({ content: '❌ บอทไม่ได้อยู่ในห้องเสียง' });
            }
        } catch (err) {
            console.error('Voice leave failed:', err);
            await interaction.editReply({ content: 'เกิดข้อผิดพลาดตอนพยายามออกจากช่องเสียง' });
        }
    }

    // --- คำสั่งกดปัดขวา "อ่านข้อความนี้" ---
    else if (commandName === 'อ่านข้อความนี้') {
        await interaction.deferReply({ ephemeral: false });

        const connection = getVoiceConnection(guild.id);
        
        if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
            return interaction.editReply({ 
                content: '❌ บอทยังไม่ได้อยู่ในห้องเสียง! โปรดใช้คำสั่ง `/join` ก่อนนะ'
            });
        }

        const textToSpeak = interaction.targetMessage.content;
        if (!textToSpeak || textToSpeak.trim().length === 0) {
            return interaction.editReply({ content: '❌ ข้อความนี้ไม่มีตัวหนังสือให้อ่าน (อาจเป็นรูปภาพหรือไฟล์)' });
        }

        try {
            const url = googleTTS.getAudioUrl(textToSpeak.slice(0, 200), {
                lang: 'th',
                slow: false,
                host: 'https://translate.google.com',
            });

            const resource = createAudioResource(url);
            player.play(resource);

            return interaction.editReply({ 
                content: `🗣️ กำลังอ่าน: "${textToSpeak.length > 50 ? textToSpeak.slice(0, 50) + '...' : textToSpeak}"`
            });
        } catch (error) {
            console.error('TTS Context Menu Error:', error);
            return interaction.editReply({ content: '❌ เกิดข้อผิดพลาดในการแปลงเสียง' });
        }
    }
});

// -------------------------------------------------------------
// Voice Disconnect Event & Message Reader
// -------------------------------------------------------------
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (oldState.member.id === client.user.id) {
        if (oldState.channelId && !newState.channelId) {
            const connection = getVoiceConnection(oldState.guild.id);
            if (connection) {
                try {
                    connection.destroy();
                } catch (e) {
                    console.error('Error destroying voice connection on kick:', e);
                }
            }
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const now = Date.now();
    
    if (COOLDOWN_MAP.has(userId)) return; 
    
    const userMessages = SPAM_MAP.get(userId) || [];
    const recentMessages = userMessages.filter(timestamp => now - timestamp < PER_TIME_MS);
    recentMessages.push(now);
    SPAM_MAP.set(userId, recentMessages);

    if (recentMessages.length > MAX_MESSAGES) {
        await message.reply(`🚨 **${message.author.username}**, โปรดส่งข้อความช้าลง!`);
        SPAM_MAP.delete(userId); 
        COOLDOWN_MAP.set(userId, now); 
        setTimeout(() => COOLDOWN_MAP.delete(userId), WARNING_COOLDOWN_MS);
        return;
    }

    const content = message.content;
    const connection = getVoiceConnection(message.guild.id);

    if (
        connection && 
        connection.state.status !== VoiceConnectionStatus.Destroyed && 
        !content.startsWith('http') && 
        message.attachments.size === 0
    ) {
        try {
            const player = getOrCreatePlayer(message.guild.id);
            const textToSpeak = content.substring(0, 200);
            const url = googleTTS.getAudioUrl(textToSpeak, {
                lang: 'th',
                slow: false,
                host: 'https://translate.google.com',
            });

            const resource = createAudioResource(url);
            player.play(resource);
        } catch (error) {
            console.error('TTS Error:', error);
        }
    }
});

process.on('unhandledRejection', reason => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));

if (!process.env.TOKEN) {
    console.error('❌ ไม่พบ TOKEN ใน Environment Variables!');
} else {
    client.login(process.env.TOKEN);
}
