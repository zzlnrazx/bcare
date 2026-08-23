import dotenv from 'dotenv';
import express from 'express';
import { 
    Client, 
    Events, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder,
    ApplicationCommandType 
} from 'discord.js';
import { 
    joinVoiceChannel, 
    getVoiceConnection, 
    createAudioPlayer, 
    createAudioResource,
    VoiceConnectionStatus,
    entersState
} from '@discordjs/voice';
import googleTTS from 'google-tts-api';

// 1. ดึง .env เฉพาะตอนรันเครื่องตัวเอง
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

// 2. ระบบ Express Web Server ให้ Render บายพาสพอร์ต 10000
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running online 24/7!');
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// 3. Discord Client & Voice Config
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

// Anti-Spam Config
const MAX_MESSAGES = 5; 
const PER_TIME_MS = 5000; 
const WARNING_COOLDOWN_MS = 10000; 

const SPAM_MAP = new Map();
const COOLDOWN_MAP = new Map(); 

// 4. Commands List (รวม /ping, /join, /leave และ อ่านข้อความ)
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('ให้บอทเข้าห้องเสียงเพื่อเตรียมอ่านแชต'),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('สั่งให้บอทออกจากห้องเสียง'),
    {
        name: 'อ่านข้อความนี้',
        type: ApplicationCommandType.Message
    }
].map(command => typeof command.toJSON === 'function' ? command.toJSON() : command);

// 5. Ready Event & Register Commands
client.on(Events.ClientReady, async readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('กำลังลงทะเบียน Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENTID || readyClient.user.id),
            { body: commands }
        );
        console.log('ลงทะเบียน Commands สำเร็จแล้ว!');
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการลงทะเบียน Commands:', error);
    }
});

// 6. Interaction Event
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
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return await interaction.reply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนสั่งให้บอทเข้า!', ephemeral: true });
        }

        let connection = getVoiceConnection(guild.id);

        if (connection && 
            connection.joinConfig.channelId === voiceChannel.id && 
            connection.state.status !== VoiceConnectionStatus.Destroyed) {
            return await interaction.reply({ content: 'ฉันอยู่ในห้องเสียงนี้อยู่แล้วครับ!', ephemeral: true });
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
            await interaction.reply(`🔊 บอทเข้าห้อง **${voiceChannel.name}** เรียบร้อยแล้ว!`);
        } catch (err) {
            console.error('Voice join failed:', err);
            await interaction.reply({ content: 'ไม่สามารถเข้าร่วมช่องเสียงได้', ephemeral: true });
        }
    } 
    
    // --- คำสั่ง /leave ---
    else if (commandName === 'leave') {
        try {
            const connection = getVoiceConnection(guild.id);
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
                await interaction.reply({ content: '👋 บอทออกจากห้องเสียงเรียบร้อยแล้ว!' });
            } else {
                await interaction.reply({ content: '❌ บอทไม่ได้อยู่ในห้องเสียง', ephemeral: true });
            }
        } catch (err) {
            console.error('Voice leave failed:', err);
            await interaction.reply({ content: 'เกิดข้อผิดพลาดตอนพยายามออกจากช่องเสียง', ephemeral: true });
        }
    }

    // --- คำสั่งกดปัดขวา "อ่านข้อความนี้" ---
    else if (commandName === 'อ่านข้อความนี้') {
        const connection = getVoiceConnection(guild.id);
        
        if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
            return interaction.reply({ 
                content: '❌ บอทยังไม่ได้อยู่ในห้องเสียง! โปรดใช้คำสั่ง `/join` ก่อนนะ', 
                ephemeral: true 
            });
        }

        const textToSpeak = interaction.targetMessage.content;
        if (!textToSpeak || textToSpeak.trim().length === 0) {
            return interaction.reply({ content: '❌ ข้อความนี้ไม่มีตัวหนังสือให้อ่าน (อาจเป็นรูปภาพหรือไฟล์)', ephemeral: true });
        }

        try {
            const url = googleTTS.getAudioUrl(textToSpeak.slice(0, 200), {
                lang: 'th',
                slow: false,
                host: 'https://translate.google.com',
            });

            const resource = createAudioResource(url);
            player.play(resource);

            return interaction.reply({ 
                content: `🗣️ กำลังอ่าน: "${textToSpeak.length > 50 ? textToSpeak.slice(0, 50) + '...' : textToSpeak}"`, 
                ephemeral: false 
            });
        } catch (error) {
            console.error('TTS Context Menu Error:', error);
            return interaction.reply({ content: '❌ เกิดข้อผิดพลาดในการแปลงเสียง', ephemeral: true });
        }
    }
});

// 7. จัดการกรณีบอทโดนเตะออกจากห้องเสียง
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

// 8. อ่านแชตอัตโนมัติ + Anti-Spam
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

// 9. Login Safety Check
if (!process.env.TOKEN) {
    console.error('❌ ไม่พบ TOKEN ใน Environment Variables!');
} else {
    client.login(process.env.TOKEN);
}
