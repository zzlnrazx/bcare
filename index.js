import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus
} from '@discordjs/voice';
import * as googleTTS from 'google-tts-api';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// ==========================================
// 1. WEB SERVER SETUP (เพื่อไม่ให้ Render Kill Process)
// ==========================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('fuyukibotalpha is active and running!');
});

app.listen(PORT, () => {
    console.log(`[EXPRESS] Server running on port ${PORT}`);
});

// ==========================================
// 2. DISCORD CLIENT CREATION
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// 3. DEFINE SLASH COMMANDS
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('เช็คสถานะการเชื่อมต่อของบอท'),

    new SlashCommandBuilder()
        .setName('say')
        .setDescription('สั่งให้บอทพูดเสียง TTS ในช่องเสียง')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('ข้อความที่ต้องการให้บอทพูด')
                .setRequired(true)
        )
].map(command => command.toJSON());

// ==========================================
// 4. AUTO REGISTER COMMANDS & READY EVENT
// ==========================================
client.once('ready', async () => {
    console.log(`[DISCORD] Logged in as ${client.user.tag}`);

    const TOKEN = process.env.DISCORD_TOKEN;
    const CLIENT_ID = process.env.CLIENT_ID || client.user.id;

    if (!TOKEN) {
        console.error('[ERROR] Missing DISCORD_TOKEN in Environment Variables!');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('[REST] Refreshing application (/) commands...');
        
        // ลงทะเบียนคำสั่งแบบ Global
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log('[REST] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('[REST ERROR] Could not register commands:', error);
    }
});

// ==========================================
// 5. COMMAND INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- /ping ---
    if (commandName === 'ping') {
        await interaction.reply({ content: '🏓 พง! บอทตอบสนองปกติครับ', ephemeral: true });
    }

    // --- /say ---
    if (commandName === 'say') {
        const text = interaction.options.getString('text');
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ 
                content: '❌ คุณต้องเข้าช่องเสียง (Voice Channel) ก่อนใช้คำสั่งนี้!', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        try {
            // สร้างลิงก์เสียงจาก Google TTS (ภาษาไทย)
            const ttsUrl = googleTTS.getAudioUrl(text, {
                lang: 'th',
                slow: false,
                host: 'https://translate.google.com',
                timeout: 10000,
            });

            // เข้าช่องเสียง
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            // รอจนกว่าจะเชื่อมต่อช่องเสียงสำเร็จ (ป้องกันค้าง)
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

            // เล่นเสียง
            const player = createAudioPlayer();
            const resource = createAudioResource(ttsUrl);

            player.play(resource);
            connection.subscribe(player);

            // เมื่อพูดจบให้หลุดออกจากช่องเสียง
            player.on(AudioPlayerStatus.Idle, () => {
                connection.destroy();
            });

            await interaction.editReply(`🔊 กำลังพูด: "${text}"`);
        } catch (error) {
            console.error('[TTS ERROR]', error);
            await interaction.editReply('❌ เกิดข้อผิดพลาดในการเชื่อมต่อช่องเสียงหรือเล่น TTS');
        }
    }
});

// ==========================================
// 6. START BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);
