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
    AudioPlayerStatus 
} from '@discordjs/voice';
import * as googleTTS from 'google-tts-api';
import express from 'express';

// ------------------------------------------------------------------
// 1. WEB SERVER FOR RENDER PING (ป้องกันบอทหลับ/ชัตดาวน์)
// ------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot is online and healthy!');
});

app.listen(PORT, () => {
    console.log(`[HTTP] Web server listening on port ${PORT}`);
});

// ------------------------------------------------------------------
// 2. DISCORD CLIENT INITIALIZATION
// ------------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ------------------------------------------------------------------
// 3. DEFINE SLASH COMMANDS
// ------------------------------------------------------------------
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('เช็กสถานะการตอบสนองของบอท'),
    
    new SlashCommandBuilder()
        .setName('speak')
        .setDescription('สั่งให้บอทพูดในช่องเสียง (TTS)')
        .addStringOption(option => 
            option.setName('text')
                .setDescription('ข้อความที่ต้องการให้พูด')
                .setRequired(true)
        )
].map(command => command.toJSON());

// ------------------------------------------------------------------
// 4. REGISTER COMMANDS & BOT READY EVENT
// ------------------------------------------------------------------
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
        console.log('[REST] Started refreshing application (/) commands.');
        
        // ลงทะเบียนแบบ Global Commands
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log('[REST] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('[REST ERROR] Failed to register commands:', error);
    }
});

// ------------------------------------------------------------------
// 5. INTERACTION & COMMAND HANDLING
// ------------------------------------------------------------------
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- คำสั่ง /ping ---
    if (commandName === 'ping') {
        await interaction.reply({ content: '🏓 Pong! บอทตอบสนองปกติบน Render ครับ', ephemeral: true });
    }

    // --- คำสั่ง /speak (TTS) ---
    if (commandName === 'speak') {
        const text = interaction.options.getString('text');
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ 
                content: '❌ คุณต้องเข้ามาในช่องเสียง (Voice Channel) ก่อนใช้งานคำสั่งนี้!', 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        try {
            // สร้าง URL เสียงจาก Google TTS
            const ttsUrl = googleTTS.getAudioUrl(text, {
                lang: 'th',
                slow: false,
                host: 'https://translate.google.com',
                timeout: 10000,
            });

            // เชื่อมต่อ Voice Channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            // เล่นเสียง
            const player = createAudioPlayer();
            const resource = createAudioResource(ttsUrl);

            player.play(resource);
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                connection.destroy();
            });

            await interaction.editReply(`🔊 กำลังพูด: "${text}"`);
        } catch (error) {
            console.error('[TTS ERROR]', error);
            await interaction.editReply('❌ เกิดข้อผิดพลาดในการเล่นเสียง TTS');
        }
    }
});

// ------------------------------------------------------------------
// 6. LOGIN TO DISCORD
// ------------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN);
