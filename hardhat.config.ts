import fs from "fs";
import { ethers } from "ethers";
import { HardhatUserConfig } from "hardhat/config";

import 'dotenv/config'
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import 'solidity-docgen';
import 'hardhat-tracer';

import './tasks/make_spec';


const getMnemonic = () => {
    try {
        return fs.readFileSync(".mnemonic").toString().trim();
    } catch {
        // this is a dummy mnemonic, never use it for anything.
        return "arrive furnace echo arch airport scrap glow gold brief food torch senior winner myself mutual";
    }
};

// Ensure that we have all the environment variables we need.
const mnemonic: string = process.env.MNEMONIC ? process.env.MNEMONIC : ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(32));

const chainIds = {
    hardhat: 31337,
    alpha2: 777012
};

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    etherscan: {
        // apiKey: process.env.ETHERSCAN_API_KEY,
        apiKey: "123",
        customChains: [
            {
                network: "local",
                chainId: 777012,
                urls: {
                    apiURL: "http://127.0.0.1:4000/api",
                    browserURL: "http://127.0.0.1:4000",
                },
            },
            {
                network: "alpha",
                chainId: 777012,
                urls: {
                    apiURL: "https://explorer.uniq.diamonds/api",
                    browserURL: "http://explorer.uniq.diamonds",
                },
            },
            {
                network: "alpha2",
                chainId: 777012,
                urls: {
                    apiURL: "https://explorer.uniq.diamonds/api",
                    browserURL: "http://explorer.uniq.diamonds",
                },
            },
            {
                network: "alpha3",
                chainId: 777016,
                urls: {
                    apiURL: "http://185.187.170.209:4000/api",
                    browserURL: "http://185.187.170.209:4000/",
                },
            },
        ],
    },
    contractSizer: {
        alphaSort: true,
        runOnCompile: true,
        disambiguatePaths: false,
        only: [
            "Hbbft",
            "Registry",
            ":BonusScoreSystem"
        ],
        except: ["Mock"]
    },
    gasReporter: {
        currency: "USD",
        enabled: process.env.REPORT_GAS ? true : false,
        excludeContracts: [],
        src: "./contracts",
    },
    networks: {
        hardhat: {
            accounts: {
                count: 100,
                mnemonic,
                accountsBalance: "1000000000000000000000000000"
            },
            chainId: chainIds.hardhat,
            allowUnlimitedContractSize: true,
            hardfork: "istanbul",
            minGasPrice: 0
        },
        local: {
            url: "http://127.0.0.1:8540",
            accounts: {
                mnemonic: getMnemonic(),
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        alpha: {
            url: "http://38.242.206.145:8540",
            accounts: {
                mnemonic: getMnemonic(),
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        alpha2: {
            url: "http://rpc.uniq.diamonds",
            accounts: {
                mnemonic: getMnemonic(),
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        alpha3: {
            url: "http://185.187.170.209:38000",
            accounts: {
                mnemonic: getMnemonic(),
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test",
    },
    solidity: {
        version: "0.8.25",
        settings: {
            // Disable the optimizer when debugging
            // https://hardhat.org/hardhat-network/#solidity-optimizer-support
            optimizer: {
                enabled: true,
                runs: 800,
                details: {
                    yul: true,
                },
            },
            evmVersion: "istanbul"
        },
    },
    typechain: {
        outDir: "src/types",
        target: "ethers-v6",
    },
    mocha: {
        timeout: 100000000
    },
};

export default config;
