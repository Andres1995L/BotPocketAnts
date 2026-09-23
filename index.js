require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, Events } = require('discord.js');
const mongoose = require('mongoose'); // <-- Mongoose reemplaza a sqlite3
const cron = require('node-cron');
const axios = require('axios');
const translate = require('google-translate-api-x');

console.log("✅ INICIANDO BOT DE DISCORD - CODE 9 (GIF IMGUR INTEGRADO)...");

const config = {
    welcomeChannelId: '1551633326761312441', 
    goodbyeChannelId: '1551633327331479623',
    donationChannelId: '1551633330745643088',
    autoRoleID: '1551633324886335674', 
    staffRoleID: '1551633324986863708',
    
    langRoles: {
        'role_en': '1551963175543513098',
        'role_es': '1551965332988764221',
        'role_pt': '1551965454115938435',
        'role_fr': '1551965551457206323',
        'role_tr': '1551965911781609502',
        'role_ru': '1551969541091758241'
    },

    pingRoles: {
        'role_term': '1551971806112514179',
        'role_crab': '1551972166046851103'
    }
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================================
// 🍃 CONEXIÓN A MONGODB Y MODELO DE DATOS
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🍃 Conectado con éxito a MongoDB Atlas'))
    .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    globalPoints: { type: Number, default: 0 },
    weeklyPoints: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

// ==========================================
// 📊 FUNCIÓN LEADERBOARD (Adaptada a Mongoose)
// ==========================================
async function generateLeaderboard(type, page, guildIcon) {
    const limit = 10;
    const offset = page * limit;
    const orderBy = type === 'weekly' ? 'weeklyPoints' : 'globalPoints';

    try {
        const query = { [orderBy]: { $gt: 0 } };
        const totalCount = await User.countDocuments(query);
        const maxPage = Math.max(0, Math.ceil(totalCount / limit) - 1);

        const rows = await User.find(query)
            .sort({ [orderBy]: -1 })
            .skip(offset)
            .limit(limit);

        const embed = new EmbedBuilder()
            .setColor(type === 'weekly' ? '#00FF7F' : '#00FFFF')
            .setTitle('🏆 DONATION LEADERBOARD 🏆')
            .setDescription(`Showing **${type === 'weekly' ? 'Weekly' : 'Global Total'}** donations.\n*Weekly points reset every Sunday.*`)
            .setThumbnail(guildIcon)
            .setFooter({ text: `Page ${page + 1} of${maxPage + 1}` })
            .setTimestamp();

        if (!rows || rows.length === 0) {
            embed.addFields({ name: '📊 Top Contributors', value: 'No donations recorded yet.' });
        } else {
            let leaderboardText = '';
            rows.forEach((row, index) => {
                const globalRank = (page * limit) + index;
                const rankMedal = globalRank === 0 ? '🥇' : globalRank === 1 ? '🥈' : globalRank === 2 ? '🥉' : `**#${globalRank + 1}**`;
                
                const weeklyFormatted = row.weeklyPoints.toLocaleString('en-US');
                const globalFormatted = row.globalPoints.toLocaleString('en-US');
                const displayPoints = type === 'weekly' ? `${weeklyFormatted} Weekly` : `${globalFormatted} Global Total`;
                
                leaderboardText += `${rankMedal} <@${row.userId}> ➔ **${displayPoints}**\n`;
            });
            embed.addFields({ name: '📊 Top Contributors', value: leaderboardText });
        }

        const row = new ActionRowBuilder();
        row.addComponents(
            new ButtonBuilder().setCustomId(`rank_${type}_${page - 1}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`rank_${type}_${page + 1}`).setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage)
        );

        const oppositeType = type === 'weekly' ? 'global' : 'weekly';
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`rank_${oppositeType}_0`)
                .setLabel(type === 'weekly' ? '🌍 View Global Total' : '📅 View Weekly')
                .setStyle(type === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Success)
        );

        return { embeds: [embed], components: [row] };
    } catch (error) {
        console.error('Error in generateLeaderboard:', error);
        throw error;
    }
}

// ==========================================
// 📅 CRON JOB SEMANAL (Adaptado a Mongoose)
// ==========================================
cron.schedule('0 19 * * 0', async () => {
    try {
        const rows = await User.find({ weeklyPoints: { $gt: 0 } }).sort({ weeklyPoints: -1 }).limit(10);
        const channel = client.channels.cache.get(config.donationChannelId);
        
        if (channel && rows.length > 0) {
            const announceEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🎉 WEEKLY DONATION RESET 🎉')
                .setDescription('The weekly donations have been reset! Here are the top contributors of this week. Thank you all for your amazing effort! 🐜🍃')
                .setTimestamp();

            let topText = '';
            rows.forEach((row, index) => {
                const rankMedal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**#${index + 1}**`;
                topText += `${rankMedal} <@${row.userId}> ➔ **${row.weeklyPoints.toLocaleString('en-US')}** resources\n`;
            });
            announceEmbed.addFields({ name: '🏆 Top 10 Weekly Donators', value: topText });
            
            await channel.send({ embeds: [announceEmbed] });
        }
        
        await User.updateMany({}, { weeklyPoints: 0 });
    } catch (err) {
        console.error('Error fetching weekly top for announcement:', err);
    }
}, { scheduled: true, timezone: "America/Bogota" });

client.once(Events.ClientReady, readyClient => {
    console.log(`🐜 Agonize Bot ONLINE as ${readyClient.user.tag}!`);
});

// ==========================================
// 👋 BIENVENIDAS, DESPEDIDAS Y AUTOROL
// ==========================================
client.on('guildMemberAdd', async member => {
    // 1. Asignar Auto-Rol
    if (config.autoRoleID) {
        const autoRole = member.guild.roles.cache.get(config.autoRoleID);
        if (autoRole) {
            member.roles.add(autoRole).catch(err => console.error('Error dando autorol:', err));
        }
    }

    // 2. Enviar mensaje de Bienvenida (Con GIF de Tenor)
    if (config.welcomeChannelId) {
        const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
        if (welcomeChannel) {
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#00FF7F')
                .setTitle('🐜 Welcome to Agonize!')
                .setDescription(`Welcome <@${member.user.id}> 🍃\n\nWe hope you help grow the anthill and enjoy the community.`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setImage('https://media.tenor.com/CBxyvlf0CMoAAAAM/welcome-anime.gif')
                .setFooter({ text: `Member #${member.guild.memberCount}` })
                .setTimestamp();
            
            welcomeChannel.send({ embeds: [welcomeEmbed] }).catch(() => {});
        }
    }
});

client.on('guildMemberRemove', async member => {
    // Enviar mensaje de Despedida (Con GIF de Imgur integrado)
    if (config.goodbyeChannelId) {
        const goodbyeChannel = member.guild.channels.cache.get(config.goodbyeChannelId);
        if (goodbyeChannel) {
            const goodbyeEmbed = new EmbedBuilder()
                .setColor('#FF4500')
                .setTitle('🍂 A member has left')
                .setDescription(`**${member.user.username}** has left and now...`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setImage('https://media.discordapp.net/attachments/1551633327331479623/1552172215469084735/7K64xzw0R3y1aIs.gif?ex=6ab4a486&is=6ab35306&hm=480902a6e5a11f874d780d6f623b789b322eb611d1ed3d258688db7e2f5b6689&=')
                .setTimestamp();
            
            goodbyeChannel.send({ embeds: [goodbyeEmbed] }).catch(() => {});
        }
    }
});

// ==========================================
// 🌐 TRADUCTOR POR REACCIONES (BANDERAS)
// ==========================================
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (error) { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch (error) { return; }
    }

    const textToTranslate = reaction.message.content;
    if (!textToTranslate) return;

    const flagLangs = {
        '🇬🇧': 'en', '🇺🇸': 'en',
        '🇪🇸': 'es', '🇲🇽': 'es',
        '🇧🇷': 'pt', '🇵🇹': 'pt',
        '🇫🇷': 'fr',
        '🇷🇺': 'ru',
        '🇹🇷': 'tr'
    };

    const targetLang = flagLangs[reaction.emoji.name];
    if (targetLang) {
        try {
            const result = await translate(textToTranslate, { to: targetLang });
            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setAuthor({ name: `Translated to ${targetLang.toUpperCase()} for${user.username}`, iconURL: user.displayAvatarURL() })
                .setDescription(result.text)
                .setFooter({ text: 'Agonize Translator' });
            
            await reaction.message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error('Translation Error via Reaction:', error);
        }
    }
});

// ==========================================
// 🔍 OCR Y COMANDOS DE TEXTO
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.id === config.donationChannelId && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (!attachment.contentType || !attachment.contentType.startsWith('image/')) return;

        const scanningMsg = await message.reply('🔍 **Agonize bot is scanning the screenshot...**');

        try {
            const formData = new URLSearchParams();
            formData.append('apikey', process.env.OCR_SPACE_API_KEY || 'helloworld');
            formData.append('url', attachment.url);
            formData.append('OCREngine', '2');
            formData.append('scale', 'true');
            formData.append('isTable', 'true');

            const ocrResponse = await axios.post('https://api.ocr.space/parse/image', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const parsedText = ocrResponse.data?.ParsedResults?.[0]?.ParsedText || '';
            const donations = [];

            const textLines = parsedText.split('\n');
            for (let line of textLines) {
                const userMatch = line.match(/([A-Za-z0-9_]{3,20})\s+(?:ha donado|donated)\s+(\d+)/i);
                if (userMatch) {
                    const username = userMatch[1];
                    const amount = parseInt(userMatch[2], 10);
                    if (amount >= 100 && !donations.find(d => d.amount === amount)) {
                        donations.push({ username, amount });
                    }
                }
            }

            if (donations.length === 0) {
                const numbersFound = parsedText.match(/\d{3,8}/g);
                if (numbersFound) {
                    for (let numStr of numbersFound) {
                        const amount = parseInt(numStr, 10);
                        if (amount >= 100 && !donations.find(d => d.amount === amount)) {
                            donations.push({ username: null, amount });
                        }
                    }
                }
            }

            if (donations.length === 0) {
                return scanningMsg.edit('❌ **Could not detect any valid amount.** Staff can use `!add @user amount` manually.');
            }

            if (donations.length === 1) {
                const donation = donations[0];
                const nameTag = donation.username ? `\`${donation.username}\`` : `<@${message.author.id}>`;
                
                const approveBtn = new ButtonBuilder()
                    .setCustomId(`approve_${message.author.id}_${donation.amount}`)
                    .setLabel(`Approve ${donation.amount.toLocaleString('en-US')}`)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅');

                const denyBtn = new ButtonBuilder()
                    .setCustomId(`deny_${message.author.id}`)
                    .setLabel('Deny')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌');

                const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

                await scanningMsg.edit({
                    content: `🐜 **Donation detected:** ${nameTag} donated **${donation.amount.toLocaleString('en-US')}** resources.\n<@&${config.staffRoleID}>, please verify.`,
                    components: [row]
                });
            } else {
                const options = donations.map((d, index) => ({
                    label: `${d.username ? d.username + ' - ' : ''}${d.amount.toLocaleString('en-US')} resources`,
                    description: `Claim this amount`,
                    value: `${d.amount}_${index}`
                })).slice(0, 25);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`select_donation_${message.author.id}`)
                    .setPlaceholder('Select your donation amount...')
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(selectMenu);

                await scanningMsg.edit({
                    content: `⚠️ **Multiple numbers detected!**\n<@${message.author.id}>, please select your true donation from the menu below.`,
                    components: [row]
                });
            }

        } catch (error) {
            console.error('OCR.space Error:', error);
            scanningMsg.edit('❌ **Error processing the image.**');
        }
        return;
    }

    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();
    const isStaff = message.member?.roles.cache.has(config.staffRoleID) || message.member?.permissions.has('Administrator');

    // ==========================================
    // 🌐 COMANDO DE TRADUCCIÓN (POR REPLY)
    // ==========================================
    if (command === '!translate') {
        if (!message.reference || !message.reference.messageId) {
            return message.reply('⚠️ **You must reply to a message and type `!translate` to use this command.**\n*(Debes responder a un mensaje para usar este comando).*');
        }

        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            const textToTranslate = repliedMessage.content;

            if (!textToTranslate) {
                return message.reply('⚠️ The message you replied to has no text to translate.');
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`translate_msg_${repliedMessage.id}`)
                .setPlaceholder('🌍 Choose the language / Elige el idioma...')
                .addOptions([
                    { label: 'English', value: 'en', emoji: '🇬🇧' },
                    { label: 'Español', value: 'es', emoji: '🇪🇸' },
                    { label: 'Português', value: 'pt', emoji: '🇧🇷' },
                    { label: 'Русский', value: 'ru', emoji: '🇷🇺' },
                    { label: 'Français', value: 'fr', emoji: '🇫🇷' },
                    { label: 'Türkçe', value: 'tr', emoji: '🇹🇷' },
                    { label: 'Deutsch (Alemán)', value: 'de', emoji: '🇩🇪' },
                    { label: 'Italiano', value: 'it', emoji: '🇮🇹' },
                    { label: 'Polski (Polaco)', value: 'pl', emoji: '🇵🇱' },
                    { label: '中文 (Chino)', value: 'zh-cn', emoji: '🇨🇳' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await message.reply({
                content: 'Traductor / Translator 🌐\n**Select the language you want to translate the message to:**',
                components: [row]
            });

        } catch (error) {
            console.error('Error al preparar la traducción:', error);
            message.reply('❌ Error reading the message.');
        }
        return;
    }

    if (command === '!autorole' && isStaff) {
        const subCommand = args[1] ? args[1].toLowerCase() : null;
        if (subCommand === 'ping') {
            const pingEmbed = new EmbedBuilder().setColor('#2F3136').setTitle('🔔 Co-op Pings').setDescription('Select the co-op events you want to be pinged for.\n\n🐜 = **Term code**\n🦀 = **Crab code**');
            const pingMenu = new StringSelectMenuBuilder().setCustomId('select_ping_role').setPlaceholder('Select your co-op pings...').setMinValues(0).setMaxValues(2)
                .addOptions([
                    { label: 'Term code', value: 'role_term', emoji: '🐜', description: 'Receive Termite Co-op pings' },
                    { label: 'Crab code', value: 'role_crab', emoji: '🦀', description: 'Receive Crab Co-op pings' }
                ]);
            await message.channel.send({ embeds: [pingEmbed], components: [new ActionRowBuilder().addComponents(pingMenu)] });
        } else {
            const langEmbed = new EmbedBuilder().setColor('#2F3136').setTitle('What language(s) do you speak?').setDescription('Please select your language(s) from the menu below.\n\n🇬🇧 = #english-chat\n🇪🇸 = #español-chat\n🇧🇷 = #português-chat\n🇷🇺 = #русский-chat\n🇫🇷 = #français-chat\n🇹🇷 = #türkçe-chat');
            const selectMenu = new StringSelectMenuBuilder().setCustomId('select_language_role').setPlaceholder('Select your language(s)...').setMinValues(0).setMaxValues(6)
                .addOptions([
                    { label: 'English', value: 'role_en', emoji: '🇬🇧' }, { label: 'Español', value: 'role_es', emoji: '🇪🇸' },
                    { label: 'Português', value: 'role_pt', emoji: '🇧🇷' }, { label: 'Русский', value: 'role_ru', emoji: '🇷🇺' },
                    { label: 'Français', value: 'role_fr', emoji: '🇫🇷' }, { label: 'Türkçe', value: 'role_tr', emoji: '🇹🇷' }
                ]);
            await message.channel.send({ embeds: [langEmbed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
        }
        message.delete().catch(() => {});
        return;
    }

    // ==========================================
    // 🧮 COMANDOS DE BASE DE DATOS (Adaptados a Mongoose)
    // ==========================================
    if (command === '!add' && isStaff) {
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[2], 10);
        if (!targetUser || isNaN(amount)) return message.reply('⚠️ Syntax: `!add @user [amount]`');
        
        try {
            await User.findOneAndUpdate(
                { userId: targetUser.id },
                { $inc: { globalPoints: amount, weeklyPoints: amount } },
                { upsert: true, new: true }
            );
            message.reply(`✅ Successfully added **${amount.toLocaleString('en-US')}** points to <@${targetUser.id}>.`);
        } catch (err) {
            console.error('Error in !add:', err);
            message.reply('❌ Database error.');
        }
    }

    if (command === '!remove' && isStaff) {
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[2], 10);
        if (!targetUser || isNaN(amount)) return message.reply('⚠️ Syntax: `!remove @user [amount]`');
        
        try {
            const user = await User.findOne({ userId: targetUser.id });
            if (user) {
                user.globalPoints = Math.max(0, user.globalPoints - amount);
                user.weeklyPoints = Math.max(0, user.weeklyPoints - amount);
                await user.save();
                message.reply(`✅ Successfully removed **${amount.toLocaleString('en-US')}** points from <@${targetUser.id}>.`);
            } else {
                message.reply(`⚠️ No database record found for <@${targetUser.id}>.`);
            }
        } catch (err) {
            console.error('Error in !remove:', err);
            message.reply('❌ Database error.');
        }
    }

    if (command === '!resetweek' && isStaff) {
        try {
            await User.updateMany({}, { weeklyPoints: 0 });
            message.reply('🔄 **Weekly points have been successfully reset to 0 by Staff.**');
        } catch (err) {
            console.error('Error in !resetweek:', err);
            message.reply('❌ Database error.');
        }
    }

    if (command === '!send' && isStaff) {
        const targetRole = message.mentions.roles.first();
        const targetUser = message.mentions.users.first();
        const textMessage = args.slice(2).join(' ');
        if (!targetRole && !targetUser) return message.reply('⚠️ You must mention a user or a role.');
        if (!textMessage) return message.reply('⚠️ You forgot to write the message.');
        try {
            if (targetRole) {
                targetRole.members.forEach(member => { 
                    if (!member.user.bot) member.send(`**Message from Agonize:**\n${textMessage}`).catch(() => {}); 
                });
                const replyMsg = await message.reply(`✅ DM sent to all members of **${targetRole.name}**.`);
                setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
            } else if (targetUser) {
                await targetUser.send(`**Message from Agonize:**\n${textMessage}`);
                const replyMsg = await message.reply(`✅ DM sent to **${targetUser.username}**.`);
                setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
            }
            message.delete().catch(() => {});
        } catch (error) { message.reply('❌ Error sending messages.'); }
    }

    if (command === '!say' && isStaff) {
        const textMessage = message.content.replace(/^!say\s+/i, '');
        if (!textMessage) return message.reply('⚠️ You forgot to write the message.');
        const sayEmbed = new EmbedBuilder().setColor('#00FFFF').setAuthor({ name: '🐜 Agonize Official Announcement', iconURL: client.user.displayAvatarURL() }).setDescription(textMessage).setTimestamp();
        try {
            await message.channel.send({ embeds: [sayEmbed] });
            message.delete().catch(() => {});
        } catch (error) {}
    }

    if (command === '!rank') {
        try {
            const leaderboardData = await generateLeaderboard('weekly', 0, message.guild.iconURL({ dynamic: true }));
            await message.channel.send(leaderboardData);
        } catch (error) {
            console.error('Error generating leaderboard:', error);
            message.reply("❌ Error loading the leaderboard from database.");
        }
    }
});

client.on('interactionCreate', async interaction => {
    // ==========================================
    // 🌐 RESPUESTA DEL MENÚ DE TRADUCCIÓN
    // ==========================================
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('translate_msg_')) {
        await interaction.deferReply({ ephemeral: false }); 

        const messageId = interaction.customId.replace('translate_msg_', '');
        const targetLang = interaction.values[0];

        try {
            const originalMessage = await interaction.channel.messages.fetch(messageId);
            const textToTranslate = originalMessage.content;

            const result = await translate(textToTranslate, { to: targetLang });

            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setAuthor({ name: `Translated to ${targetLang.toUpperCase()} for ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(result.text)
                .setFooter({ text: 'Agonize Translator' });

            await interaction.editReply({ embeds: [embed] });
            
            await interaction.message.delete().catch(() => {});

        } catch (error) {
            console.error('Error traduciendo desde menú:', error);
            await interaction.editReply({ content: '❌ **Error al intentar traducir el mensaje. (Error de red o mensaje borrado).**' });
        }
        return;
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'select_language_role' || interaction.customId === 'select_ping_role')) {
        await interaction.deferReply({ ephemeral: true });
        const selectedKeys = interaction.values;
        const configMap = interaction.customId === 'select_language_role' ? config.langRoles : config.pingRoles;
        const addedRoles = [];
        const removedRoles = [];

        for (const [key, roleId] of Object.entries(configMap)) {
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) continue;
            if (selectedKeys.includes(key)) {
                if (!interaction.member.roles.cache.has(roleId)) {
                    await interaction.member.roles.add(role).catch(() => {});
                    addedRoles.push(role.name);
                }
            } else {
                if (interaction.member.roles.cache.has(roleId)) {
                    await interaction.member.roles.remove(role).catch(() => {});
                    removedRoles.push(role.name);
                }
            }
        }
        let responseMsg = '✅ **Roles updated!**\n';
        if (addedRoles.length > 0) responseMsg += `\n➕ **Added:** ${addedRoles.join(', ')}`;
        if (removedRoles.length > 0) responseMsg += `\n➖ **Removed:** ${removedRoles.join(', ')}`;
        if (addedRoles.length === 0 && removedRoles.length === 0) responseMsg += '\nℹ️ No changes were made.';
        return interaction.editReply({ content: responseMsg });
    }

    if (interaction.isButton() && interaction.customId.startsWith('rank_')) {
        const parts = interaction.customId.split('_');
        const type = parts[1];
        const page = parseInt(parts[2], 10);
        try {
            const leaderboardData = await generateLeaderboard(type, page, interaction.guild.iconURL({ dynamic: true }));
            await interaction.update(leaderboardData);
        } catch (error) {
            await interaction.reply({ content: '❌ Error loading the next page.', ephemeral: true });
        }
        return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_donation_')) {
        const claimerId = interaction.customId.split('_')[2];
        if (interaction.user.id !== claimerId) return interaction.reply({ content: '❌ Only the user who uploaded the image can select their donation.', ephemeral: true });

        const selectedAmount = parseInt(interaction.values[0].split('_')[0], 10);
        const approveBtn = new ButtonBuilder().setCustomId(`approve_${claimerId}_${selectedAmount}`).setLabel(`Approve ${selectedAmount.toLocaleString('en-US')}`).setStyle(ButtonStyle.Success).setEmoji('✅');
        const denyBtn = new ButtonBuilder().setCustomId(`deny_${claimerId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌');
        const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

        await interaction.update({ content: `🐜 **Donation selected:** **${selectedAmount.toLocaleString('en-US')}** resources.\n<@&${config.staffRoleID}>, please verify.`, components: [row] });
    }

    // ==========================================
    // ✅❌ BOTONES DE APROBAR / RECHAZAR (Adaptado a Mongoose)
    // ==========================================
    if (interaction.isButton() && (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_'))) {
        if (!interaction.member.roles.cache.has(config.staffRoleID) && !interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '❌ You do not have Staff permissions to manage donations.', ephemeral: true });
        }

        if (interaction.customId.startsWith('deny_')) {
            const claimerId = interaction.customId.split('_')[1];
            const disabledBtn = new ButtonBuilder().setCustomId('denied_done').setLabel(`Denied by ${interaction.user.username}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
            const updatedRow = new ActionRowBuilder().addComponents(disabledBtn);
            return interaction.update({ content: `❌ **Donation denied.**\nThe submission for <@${claimerId}> has been rejected.`, components: [updatedRow] });
        }

        if (interaction.customId.startsWith('approve_')) {
            const dataParts = interaction.customId.split('_');
            const claimerId = dataParts[1];
            const amount = parseInt(dataParts[2], 10);

            try {
                await User.findOneAndUpdate(
                    { userId: claimerId },
                    { $inc: { globalPoints: amount, weeklyPoints: amount } },
                    { upsert: true }
                );

                const disabledBtn = new ButtonBuilder().setCustomId('approved_done').setLabel(`Approved by ${interaction.user.username}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
                const updatedRow = new ActionRowBuilder().addComponents(disabledBtn);
                await interaction.update({ content: `✅ **Donation approved!**\nAdded **${amount.toLocaleString('en-US')}** resources to <@${claimerId}> profile.`, components: [updatedRow] });
            } catch (error) {
                console.error('Error approving donation:', error);
                await interaction.followUp({ content: '❌ Database error saving the donation.', ephemeral: true });
            }
        }
    }
});
const http = require('http');
http.createServer((req, res) => {
    res.write("Bot is alive!");
    res.end();
}).listen(process.env.PORT || 8080);
client.login(process.env.TOKEN);