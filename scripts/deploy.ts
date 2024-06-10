import { ValidatorSetHbbft } from '../src/types'
import { ethers, run } from 'hardhat'

async function deployValidatorSetHbbft() {
    const ValidatorSetHbbft = await ethers.getContractFactory('ValidatorSetHbbft')
    console.log('starting deploying token...')
    const validator = await ValidatorSetHbbft.deploy() as ValidatorSetHbbft
    console.log('ValidatorSetHbbft deployed with address: ' + await validator.getAddress())
    console.log('wait of deploying...')
    await validator.waitForDeployment()
    console.log('wait of delay...')

    // await delay(25000)
    // console.log('starting verify token...')
    // try {
    //     await run('verify:verify', {
    //         address: validator!.address,
    //         contract: 'contracts/ValidatorSetHbbft.sol:ValidatorSetHbbft',
    //     });
    //     console.log('verify success')
    // } catch (e: any) {
    //     console.log(e.message)
    // }
}

deployValidatorSetHbbft()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })

const delay = async (time: number) => {
    return new Promise((resolve: any) => {
        setInterval(() => {
            resolve()
        }, time)
    })
}
