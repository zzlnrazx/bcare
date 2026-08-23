import dotenv from 'dotenv';
// โหลด .env เฉพาะตอนรันบนเครื่องตัวเอง (Local)
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}
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

dotenv.config();
import express from 'express';

// สร้าง Web Server เพื่อหลอก Render ให้เปิด Port 3000 (เพื่อใช้แบบฟรี)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is online!');
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// 1. ตั้งค่า Client
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// สร้าง Map เก็บ AudioPlayer แยกตาม Guild (ป้องกันเสียงตีกันหรือผู้เล่นเสียงค้าง)
const guildPlayers = new Map();

function getOrCreatePlayer(guildId) {
    if (!guildPlayers.has(guildId)) {
        guildPlayers.set(guildId, createAudioPlayer());
    }
    return guildPlayers.get(guildId);
}

// ตัวแปรและค่าคงที่สำหรับ Anti-Spam
const MAX_MESSAGES = 5; 
const PER_TIME_MS = 5000; 
const WARNING_COOLDOWN_MS = 10000; 

const SPAM_MAP = new Map();
const COOLDOWN_MAP = new Map(); 

// 2. สร้างโครงสร้าง Commands (Slash Commands + Context Menu ปัดขวา)
const commands = [
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

// 3. Register Commands เมื่อบอทเริ่มทำงาน
client.on(Events.ClientReady, async readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('กำลังลงทะเบียน Commands...');
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands }
        );
        console.log('ลงทะเบียน Commands สำเร็จแล้ว!');
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการลงทะเบียน Commands:', error);
    }
});

// 4. จัดการการเรียกใช้ Commands (/join, /leave และ ปัดขวาอ่านข้อความ)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const { commandName, guild, member } = interaction;
    const player = getOrCreatePlayer(guild.id);

    // --- คำสั่ง /join ---
    if (commandName === 'join') {
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return await interaction.reply({ content: 'คุณต้องอยู่ในช่องเสียงก่อน!', ephemeral: true });
        }

        let connection = getVoiceConnection(guild.id);

        // กรณีบอทอยู่ในห้องนั้นแล้วจริงๆ
        if (connection && 
            connection.joinConfig.channelId === voiceChannel.id && 
            connection.state.status !== VoiceConnectionStatus.Destroyed) {
            return await interaction.reply({ content: 'ฉันอยู่ในห้องเสียงนี้อยู่แล้วครับ! <:xsax:1541120037304139786>', ephemeral: true });
        }

        try {
            // หากมี connection เดิมที่ค้างอยู่ ให้เคลียร์ทิ้งก่อน
            if (connection) {
                connection.destroy();
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            // ตรวจจับสถานะการหลุดสาย / โดนเตะ / โดนย้าย
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    // รอสลับสายกรณีโดนย้ายห้อง (Reconnecting) หากเกิน 5 วิแสดงว่าโดนเตะออกจริง
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    // หากโดนเตะจริง ให้ล้าง Connection
                    try { connection.destroy(); } catch (e) {}
                }
            });

            connection.subscribe(player);
            await interaction.reply(`Joined **${voiceChannel.name}** <:xsax:1541120037304139786>`);
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
                await interaction.reply({ content: '👋 ออกจากช่องเสียงเรียบร้อยแล้ว!' });
            } else {
                await interaction.reply({ content: 'ฉันไม่ได้อยู่ในช่องเสียงตอนนี้', ephemeral: true });
            }
        } catch (err) {
            console.error('Voice leave failed:', err);
            await interaction.reply({ content: 'เกิดข้อผิดพลาดตอนพยายามออกจากช่องเสียง', ephemeral: true });
        }
    }

    // --- คำสั่งกดปัดขวา/คลิกขวาที่ข้อความ "อ่านข้อความนี้" ---
    else if (commandName === 'อ่านข้อความนี้') {
        const connection = getVoiceConnection(guild.id);
        
        if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
            return interaction.reply({ 
                content: '❌ บอทไม่ได้อยู่ในห้องเสียง! โปรดใช้คำสั่ง `/join` ก่อนนะครับ', 
                ephemeral: true 
            });
        }

        const textToSpeak = interaction.targetMessage.content;
        if (!textToSpeak || textToSpeak.trim().length === 0) {
            return interaction.reply({ content: '❌ ข้อความนี้ไม่มีตัวหนังสือให้อ่าน', ephemeral: true });
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

// 5. Event: Voice State Update (ตรวจจับตอนบอทโดนเตะออกจากห้องโดยตรง)
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    // เช็กเฉพาะการเปลี่ยนแปลงของตัวบอทเอง
    if (oldState.member.id === client.user.id) {
        // หากเคยอยู่ในห้องเสียง แต่ตอนนี้ไม่มีช่องเสียงแล้ว (โดนเตะออก)
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

// 6. Event: Message Create (แชตปกติ, Anti-Spam และระบบอ่าน TTS อัตโนมัติ)
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const now = Date.now();
    
    // Anti-Spam Logic
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

    // --- ระบบ TTS อ่านข้อความแชตอัตโนมัติเมื่อบอทอยู่ในห้องเสียง ---
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

client.login(process.env.TOKEN);