import { ethers, network, upgrades } from "hardhat";

import { BaseContract, BigNumber } from "ethers";

import {
  TxPermissionHbbft,
} from "../../src/types";


export class Permission<T extends BaseContract>
{
  public constructor(public permissionContract: TxPermissionHbbft, public contract: T, public logOutput = false) {

  }


  public async callFunction(functionName: string, from: string, params: any[]) {

    
    //keyGenHistory.interface.encodeFunctionData()
    const asEncoded = this.contract.interface.encodeFunctionData(functionName, params);
    if (this.logOutput) {
      console.log('calling: ', functionName);
      console.log('from: ', from)
      console.log('params: ', params);
      console.log('encodedCall: ', asEncoded);
    }

    //const numberFromContract = await txPermission._getSliceUInt256(4, asEncoded);
    //const numberFromContract2 = await txPermission._decodeUInt256Param(4, asEncoded);
    //console.log('upcommingEpochNumber: ', numberFromContract.toString());
    //console.log('numberFromContract2', numberFromContract2.toString());


    const allowedTxType = await this.permissionContract.allowedTxTypes(from, this.contract.address, '0x0' /* value */, '0x0' /* gas price */, asEncoded);

    //console.log(allowedTxType.typesMask.toString());
    // don't ask to cache this result.
    allowedTxType.cache.should.be.equal(false);

    /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
    /// 0x02 - contract call;
    /// 0x04 - contract creation;
    /// 0x08 - private transaction.

    allowedTxType.typesMask.should.be.equal(BigNumber.from('2'), 'Transaction should be allowed according to TxPermission Contract.');

    // we know now, that this call is allowed.
    // so we can execute it.
    await (await ethers.getSigner(from)).sendTransaction({ to: this.contract.address, data: asEncoded });
  }
}