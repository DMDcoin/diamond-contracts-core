import { ethers } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export class SpecialContract {
    public name?: string;
    public address?: string;
    public bytecode?: string;

    public constructor(
        name?: string,
        address?: string,
        bytecode?: string
    ) {
        this.name = name;
        this.address = address;
        this.bytecode = bytecode;
    }

    async compileContract(hre: HardhatRuntimeEnvironment, args: any[]): Promise<string> {
        const factory = await hre.ethers.getContractFactory(this.name!);
        const tx = factory.getDeployTransaction(...args);

        this.bytecode = tx.data!.toString();
    }

    toSpecAccount(balance: number) {
        return {
            [this.address!]: {
                balance: balance.toString(),
                constructor: this.bytecode!
            }
        };
    }
}

export class CoreContract {
    public name?: string;
    public proxyAddress?: string;
    public proxyBytecode?: string;
    public implementationAddress?: string;
    public implementationBytecode?: string;

    public constructor(
        name?: string,
        proxyAddress?: string,
        implementationAddress?: string,
        proxyBytecode?: string,
        implementationBytecode?: string
    ) {
        this.name = name;
        this.proxyAddress = proxyAddress;
        this.proxyBytecode = proxyBytecode;
        this.implementationAddress = implementationAddress;
        this.implementationBytecode = implementationBytecode;
    }

    isProxy(): boolean {
        return this.proxyAddress !== '';
    }

    async compileProxy(proxyContractName: string, hre: HardhatRuntimeEnvironment, args: any[]) {
        const factory = await hre.ethers.getContractFactory(proxyContractName);
        const tx = factory.getDeployTransaction(...args);

        this.proxyBytecode = tx.data!.toString();
    }

    async compileContract(hre: HardhatRuntimeEnvironment) {
        const factory = await hre.ethers.getContractFactory(this.name!);

        this.implementationBytecode = factory.bytecode;
    }

    toSpecAccount(useUpgradeProxy: boolean, initialBalance: number) {
        let spec = {};

        if (useUpgradeProxy) {
            spec[this.implementationAddress!] = {
                balance: '0',
                constructor: this.implementationBytecode
            };

            spec[this.proxyAddress!] = {
                balance: initialBalance.toString(),
                constructor: this.proxyBytecode
            };
        } else {
            spec[this.proxyAddress!] = {
                balance: initialBalance.toString(),
                constructor: this.implementationBytecode
            }
        }

        return spec;
    }
}

export class InitialContractsConfiguration {
    public core: CoreContract[];
    public admin?: SpecialContract;
    public initializer?: SpecialContract;
    public registry?: SpecialContract;

    static from(json: any): InitialContractsConfiguration {
        const instance = new InitialContractsConfiguration();

        for (const [key, value] of Object.entries(json)) {
            if (key == 'core') {
                instance[key] = (value as Array<any>).map(x => new CoreContract(...(Object.values(x as any) as [])));
            }

            if (key == 'admin' || key == 'initializer' || key == 'registry') {
                instance[key] = new SpecialContract(...(Object.values(value as any) as []));
            }
        }

        return instance;
    }

    getAddressByContractName(name: string): string | undefined {
        const found = this.core.find(obj => obj.name === name);

        return found ? found.proxyAddress : ethers.constants.AddressZero;
    }
}
