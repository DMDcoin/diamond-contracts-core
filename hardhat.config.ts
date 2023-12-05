import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "@openzeppelin/hardhat-upgrades";
import 'solidity-docgen';
import 'hardhat-tracer';
import { config as dotenvConfig } from "dotenv";
import type { NetworkUserConfig } from "hardhat/types";
// ToDo::check why config excluding gas reporter and typechain
import type { HardhatUserConfig } from "hardhat/config";
import { resolve } from "path";
import { utils } from "ethers";
import fs from "fs";

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || "./.env";
dotenvConfig({ path: resolve(__dirname, dotenvConfigPath) });

// ToDo::change require to smth more suitable
require('./tasks');

const getMnemonic = () => {
    try {
        return fs.readFileSync(".mnemonic").toString().trim();
    } catch {
        // this is a dummy mnemonic, never use it for anything.
        return "arrive furnace echo arch airport scrap glow gold brief food torch senior winner myself mutual";
    }
};

// Ensure that we have all the environment variables we need.
const mnemonic: string = process.env.MNEMONIC ? process.env.MNEMONIC : utils.entropyToMnemonic(utils.randomBytes(32));

const infuraApiKey: string = process.env.INFURA_API_KEY ? process.env.INFURA_API_KEY : "";

const chainIds = {
    hardhat: 31337,
    alpha2: 777012
};

function getChainConfig(chain: keyof typeof chainIds): NetworkUserConfig {
    let jsonRpcUrl: string;
    switch (chain) {
        case "alpha2":
            jsonRpcUrl = "http://rpc.uniq.diamonds:8540";
            break;
        default:
            jsonRpcUrl = "https://" + chain + ".infura.io/v3/" + infuraApiKey;
    }
    return {
        accounts: {
            count: 10,
            mnemonic,
            path: "m/44'/60'/0'/0",
        },
        chainId: chainIds[chain],
        gas: 21_000_000_000,
        gasPrice: 1_000_000_000,
        allowUnlimitedContractSize: true,
        blockGasLimit: 100000000429720,
        url: jsonRpcUrl,
    };
}

const config: {} = {
    defaultNetwork: "hardhat",
    etherscan: {
        // apiKey: process.env.ETHERSCAN_API_KEY,
        apiKey: "123",
        customChains: [
            {
                network: "alpha",
                chainId: 777012,
                urls: {
                    apiURL: "http://explorer.uniq.diamonds/api",
                    browserURL: "http://explorer.uniq.diamonds",
                },
            },
            {
                network: "alpha2",
                chainId: 777012,
                urls: {
                    apiURL: "http://explorer.uniq.diamonds/api",
                    browserURL: "http://explorer.uniq.diamonds",
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
            "Registry"
        ],
        except: [
            "Mock",
            "Sacrifice",
            "Base"
        ]
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
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test",
    },
    solidity: {
        version: "0.8.17",
        settings: {
            // metadata: {
            //     // Not including the metadata hash
            //     // https://github.com/paulrberg/hardhat-template/issues/31
            //     bytecodeHash: "none",
            // },
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
        target: "ethers-v5",
    },
    mocha: {
        timeout: 100000000
    },
};

export default config;
