import { ethers } from "hardhat";
import { BaseContract, TransactionResponse } from "ethers";

import { TxPermissionHbbft } from "../../src/types";
import { expect } from "chai";

export class Permission<T extends BaseContract> {
  public constructor(public permissionContract: TxPermissionHbbft, public contract: T, public logOutput = false) { }

  public async callFunction(functionName: string, from: string, params: any[]): Promise<TransactionResponse> {
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
    //console.log('upcomingEpochNumber: ', numberFromContract.toString());
    //console.log('numberFromContract2', numberFromContract2.toString());


    const allowedTxType = await this.permissionContract.allowedTxTypes(
      from,
      await this.contract.getAddress(),
      0n /* value */,
      0n /* gas price */,
      asEncoded
    );

    //console.log(allowedTxType.typesMask.toString());
    // don't ask to cache this result.
    expect(allowedTxType.cache).to.be.false;

    /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
    /// 0x02 - contract call;
    /// 0x04 - contract creation;
    /// 0x08 - private transaction.

    expect(allowedTxType.typesMask).to.be.equal(2n, 'Transaction should be allowed according to TxPermission Contract.');

    // we know now, that this call is allowed.
    // so we can execute it.
    return (await ethers.getSigner(from)).sendTransaction({
      to: await this.contract.getAddress(),
      data: asEncoded
    });
  }
}
