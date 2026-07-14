import { english, generateMnemonic } from "viem/accounts";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatLedger from "@nomicfoundation/hardhat-ledger";
import hardhatFoundry from "@nomicfoundation/hardhat-foundry";
import hardhatContractSizer from "@solidstate/hardhat-contract-sizer";

// Set encrypted variables using:
// pnpm hardhat keystore set DEV_DEPLOYER_PRIVATE_KEY
// pnpm hardhat keystore set MNEMONIC
const accounts = [configVariable("DEV_DEPLOYER_PRIVATE_KEY")];
const mnemonic = configVariable("MNEMONIC") || generateMnemonic(english);

const proxyContractsToBuild = [
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol",
    "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol",
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
];

export default defineConfig({
    plugins: [
        hardhatToolboxViem,
        hardhatLedger,
        hardhatFoundry,
        hardhatContractSizer,
    ],
    solidity: {
        npmFilesToBuild: proxyContractsToBuild,
        version: "0.8.25",
        settings: {
            optimizer: {
                enabled: true,
                runs: 800,
                details: {
                    yul: true,
                },
            },
            evmVersion: "london",
        },
    },
    networks: {
        default: {
            type: "edr-simulated",
            accounts: {
                count: 100,
                mnemonic,
                accountsBalance: "1000000000000000000000000000",
            },
            chainId: 31337,
            allowUnlimitedContractSize: true,
            hardfork: "istanbul",
            minGasPrice: 0,
        },
        local: {
            type: "http",
            chainType: "l1",
            url: "http://127.0.0.1:8540",
            accounts: {
                mnemonic: mnemonic,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        beta: {
            type: "http",
            chainType: "l1",
            url: "https://beta-rpc.bit.diamonds",
            accounts: {
                mnemonic: mnemonic,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        testnet: {
            type: "http",
            chainType: "l1",
            url: "http://62.171.133.46:20100",
            accounts: {
                mnemonic: mnemonic,
                path: "m/44'/60'/0'/0",
                initialIndex: 0,
                count: 20,
                passphrase: "",
            },
            gasPrice: 1000000000,
        },
        mainnet: {
            type: "http",
            chainType: "l1",
            url: "https://rpc.bit.diamonds",
            chainId: 17771,
            accounts: accounts,
        },
        forked: {
            type: "http",
            chainType: "l1",
            gasPrice: 0,
            url: "http://127.0.0.1:8545",
            timeout: 1_000_000,
        },
    },
    coverage: {
        skipFiles: ["interfaces", "mocks"],
    },
    paths: {
        sources: "./contracts",
        tests: {
            nodejs: "./test",
        },
    },
    contractSizer: {
        alphaSort: true,
        runOnCompile: true,
        only: [
            /Hbbft/i,
            /KeyGenHistory/i,
            /BonusScoreSystem/i,
        ],
        except: [
            /Mock/i,
        ],
    },
});
