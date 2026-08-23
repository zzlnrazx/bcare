import dotenv from 'dotenv';
import { REST, Routes, SlashCommandBuilder, ApplicationCommandType } from 'discord.js';

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

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

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('⏳ กำลังลงทะเบียน Slash Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENTID),
            { body: commands }
        );
        console.log('✅ ลงทะเบียน Commands สำเร็จเรียบร้อย!');
    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการลงทะเบียน Commands:', error);
    }
})();
