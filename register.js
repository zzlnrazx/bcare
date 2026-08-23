import dotenv from 'dotenv';
import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  ApplicationCommandType 
} from 'discord.js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  getVoiceConnection 
} from '@discordjs/voice';
import * as googleTTS from 'google-tts-api';

dotenv.config();

// -------------------------------------------------------------
// 1. ส่วนกำหนด Slash Commands & Message Context Menu (ปัดขวา/คลิกขวา)
// -------------------------------------------------------------
const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong!',
  },
  {
    name: 'join',
    description: 'ให้บอทเข้าห้องเสียงเพื่อเตรียมอ่านแชต',
  },
  {
    name: 'leave',
    description: 'สั่งให้บอทออกจากห้องเสียง',
  },
  // คำสั่ง App Context Menu เมื่อกดปัดขวา/คลิกขวาที่ข้อความ
  {
    name: 'อ่านข้อความนี้',
    type: ApplicationCommandType.Message,
  }
];

// ตัวแปรสำหรับคิวและตัวเล่นเสียง
const player = createAudioPlayer();

// -------------------------------------------------------------
// 2. ฟังก์ชันลงทะเบียนคำสั่งอัตโนมัติเมื่อเริ่มโปรแกรม
// -------------------------------------------------------------
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENTID), 
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

// -------------------------------------------------------------
// 3. เริ่มต้นสร้าง Client และ Event Listeners
// -------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  // ลงทะเบียนคำสั่ง Slash Command และ Context Menu เมื่อบอทเปิดใช้งาน
  await registerCommands();
});

// จัดการ Interaction (คำสั่ง Slash Commands และ Context Menu)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

  const guild = interaction.guild;
  const member = interaction.member;

  // --- คำสั่ง /ping ---
  if (interaction.commandName === 'ping') {
    return interaction.reply({ content: 'Pong!', ephemeral: true });
  }

  // --- คำสั่ง /join ---
  if (interaction.commandName === 'join') {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ คุณต้องอยู่ในห้องเสียงก่อนสั่งให้บอทเข้า!', ephemeral: true });
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    connection.subscribe(player);
    return interaction.reply({ content: `🔊 บอทเข้าห้อง **${voiceChannel.name}** เรียบร้อยแล้ว!`, ephemeral: false });
  }

  // --- คำสั่ง /leave ---
  if (interaction.commandName === 'leave') {
    const connection = getVoiceConnection(guild.id);
    if (!connection) {
      return interaction.reply({ content: '❌ บอทไม่ได้อยู่ในห้องเสียง', ephemeral: true });
    }

    connection.destroy();
    return interaction.reply({ content: '👋 บอทออกจากห้องเสียงเรียบร้อยแล้ว', ephemeral: false });
  }

  // --- คำสั่งกดปัดขวา/คลิกขวา "อ่านข้อความนี้" ---
  if (interaction.commandName === 'อ่านข้อความนี้') {
    const connection = getVoiceConnection(guild.id);
    if (!connection) {
      return interaction.reply({ content: '❌ บอทยังไม่ได้อยู่ในห้องเสียง! โปรดใช้คำสั่ง `/join` ก่อนนะ', ephemeral: true });
    }

    // ดึงข้อความจาก Message ที่ถูกเลือก
    const textToSpeak = interaction.targetMessage.content;
    if (!textToSpeak || textToSpeak.trim().length === 0) {
      return interaction.reply({ content: '❌ ข้อความนี้ไม่มีตัวหนังสือให้อ่าน (อาจเป็นรูปภาพหรือไฟล์)', ephemeral: true });
    }

    try {
      // แปลงข้อความสั้นๆ เป็น URL เสียงภาษาไทย (จำกัด 200 ตัวอักษรต่อครั้ง)
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
      console.error(error);
      return interaction.reply({ content: '❌ เกิดข้อผิดพลาดในการแปลงเสียง', ephemeral: true });
    }
  }
});

// เข้าสู่ระบบด้วย Token
client.login(process.env.TOKEN);