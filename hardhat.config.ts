import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "@openzeppelin/hardhat-upgrades";
import { config as dotenvConfig } from "dotenv";
import type { NetworkUserConfig } from "hardhat/types";
// ToDo::check why config excluding gas reporter and typechain
import type { HardhatUserConfig } from "hardhat/config";
import { resolve } from "path";

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || "./.env";
dotenvConfig({ path: resolve(__dirname, dotenvConfigPath) });

// ToDo::change require to smth more suitable
require('./tasks');

// Ensure that we have all the environment variables we need.
const mnemonic: string | undefined = process.env.MNEMONIC;
if (!mnemonic) {
    throw new Error("Please set your MNEMONIC in a .env file");
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;
if (!infuraApiKey) {
    throw new Error("Please set your INFURA_API_KEY in a .env file");
}

const chainIds = {
    "arbitrum-mainnet": 42161,
    avalanche: 43114,
    bsc: 56,
    ganache: 1337,
    goerli: 5,
    kovan: 42,
    hardhat: 31337,
    mainnet: 1,
    "optimism-mainnet": 10,
    "polygon-mainnet": 137,
    "polygon-mumbai": 80001,
};

function getChainConfig(chain: keyof typeof chainIds): NetworkUserConfig {
    let jsonRpcUrl: string;
    switch (chain) {
        case "avalanche":
            jsonRpcUrl = "https://api.avax.network/ext/bc/C/rpc";
            break;
        case "bsc":
            jsonRpcUrl = "https://bsc-dataseed1.binance.org";
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
        gasPrice: 8000000000,
        allowUnlimitedContractSize: true,
        blockGasLimit: 100000000429720,
        url: jsonRpcUrl,
    };
}

const config: {} = {
    defaultNetwork: "hardhat",
    etherscan: {
        apiKey: {
            arbitrumOne: process.env.ARBISCAN_API_KEY || "",
            avalanche: process.env.SNOWTRACE_API_KEY || "",
            bsc: process.env.BSCSCAN_API_KEY || "",
            goerli: process.env.ETHERSCAN_API_KEY || "",
            mainnet: process.env.ETHERSCAN_API_KEY || "",
            optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
            polygon: process.env.POLYGONSCAN_API_KEY || "",
            polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
        },
    },
    contractSizer: {
        alphaSort: true,
        runOnCompile: true,
        disambiguatePaths: false,
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
                count: 30,
                mnemonic,
                accountsBalance: "1000000000000000000000000000"
            },
            chainId: chainIds.hardhat,
            allowUnlimitedContractSize: true,
            hardfork: "istanbul",
            minGasPrice: 0
        },
        arbitrum: getChainConfig("arbitrum-mainnet"),
        avalanche: getChainConfig("avalanche"),
        bsc: getChainConfig("bsc"),
        goerli: getChainConfig("goerli"),
        mainnet: getChainConfig("mainnet"),
        optimism: getChainConfig("optimism-mainnet"),
        "polygon-mainnet": getChainConfig("polygon-mainnet"),
        "polygon-mumbai": getChainConfig("polygon-mumbai"),
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test",
    },
    solidity: {
        version: "0.5.16",
        settings: {
            //   viaIR: true,
            // metadata: {
            //     // Not including the metadata hash
            //     // https://github.com/paulrberg/hardhat-template/issues/31
            //     bytecodeHash: "none",
            // },
            // Disable the optimizer when debugging
            // https://hardhat.org/hardhat-network/#solidity-optimizer-support
            optimizer: {
                enabled: true,
                runs: 0,
            },
        },
    },
    typechain: {
        outDir: "src/types",
        target: "ethers-v5",
    },
};

export default config;
