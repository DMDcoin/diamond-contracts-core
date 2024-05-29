
import fs from 'fs';
import path from 'path';
import hre from 'hardhat';
import { ethers, upgrades } from "hardhat";
import { InitialContractsConfiguration } from '../tasks/types';

async function deployLocally(
    initialContracts: InitialContractsConfiguration,
    proxyAdminOwner: string,
) {
    let replacementMap = new Map<string, string>();

    for (let coreContract of initialContracts.core) {
        const contractFactory = await ethers.getContractFactory(coreContract.name!);
        const contract = await upgrades.deployProxy(
            contractFactory,
            {
                initializer: false,
                initialOwner: proxyAdminOwner,
            }
        );
        await contract.waitForDeployment();

        const proxyAddress = await contract.getAddress();
        const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxyAddress);

        console.log("proxy: ", proxyAddress);
        console.log("admin: ", proxyAdmin);

        const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

        replacementMap.set(proxyAddress, coreContract.proxyAddress!);
        replacementMap.set(implementationAddress, coreContract.implementationAddress!);
    }

    return replacementMap;
}

function getManifestFile(_path: string) {
    const result = fs.readdirSync(_path);

    return result.length == 1 ? path.join(_path, result[0]) : undefined;
}

async function generateNetworkManifest(
    networkId: string,
    proxyAdminOwner: string,
    initialContracts: InitialContractsConfiguration
) {
    const sourceManifestDir = `/tmp/openzeppelin-upgrades`;
    const resultingManifest = `.openzeppelin/unknown-${networkId}.json`;

    fs.rmSync(sourceManifestDir, { recursive: true, force: true });

    let replacementMap = await deployLocally(initialContracts, proxyAdminOwner);

    const sourceManifest = getManifestFile(sourceManifestDir);

    const rawdata = fs.readFileSync(sourceManifest!);
    let parsedData = JSON.parse(rawdata.toString());

    for (let i = 0; i < parsedData.proxies.length; ++i) {
        const manifestProxyAddress = parsedData.proxies[i].address;
        parsedData.proxies[i].address = replacementMap.get(manifestProxyAddress);
    }

    const implPartKeys = Object.keys(parsedData.impls);
    for (let implKey of implPartKeys) {
        const manifestImplAddress = parsedData.impls[implKey].address;
        parsedData.impls[implKey].address = replacementMap.get(manifestImplAddress);
    }

    fs.writeFileSync(resultingManifest, JSON.stringify(parsedData, null, 4));
}

async function main() {
    if (!process.env.NETWORK_ID) {
        throw new Error("Please set your NETWORK_ID in a .env file");
    }

    if (!process.env.OWNER) {
        throw new Error("Please set proxy admin OWNER address in a .env file");
    }

    const networkId = process.env.NETWORK_ID;
    const proxyAdminOwner = process.env.OWNER;

    console.log('networkId: ', networkId);
    console.log('proxy admin owner: ', proxyAdminOwner);

    const initialContracts = InitialContractsConfiguration.fromFile("initial-contracts.json");

    await generateNetworkManifest(networkId, proxyAdminOwner, initialContracts);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    });
