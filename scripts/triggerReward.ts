import { BlockRewardHbbft } from "../src/types";
import { ethers } from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params?: any[];
  id: number | string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

class EthereumCallError extends Error {
  code: number;
  message: string;
  data: any;

  constructor({ _code, _message, _data }: { _code: number; _message: string; _data: string }) {
    super();
    this.code = _code;
    this.message = _message;
    this.data = _data;
  }
}

async function triggerReward() {
  const [signer] = await ethers.getSigners();

  const BlockRewardHbbft = await ethers.getContractFactory("BlockRewardHbbft");
  const blockReward = BlockRewardHbbft.attach("0x2000000000000000000000000000000000000001") as BlockRewardHbbft;

  console.log("[net] latest block: ", await ethers.provider.getBlockNumber());

  await helpers.impersonateAccount(SystemAccountAddress);

  const systemSigner = await ethers.getSigner(SystemAccountAddress);

  const result = await blockReward.connect(systemSigner).reward(true, { gasLimit: 5_000_000, gasPrice: 0 });
  const receipt = await result.wait();

  console.log("receipt: ", receipt);

  await helpers.stopImpersonatingAccount(SystemAccountAddress);
}

async function getTxRevertReason() {
  const BlockRewardHbbft = await ethers.getContractFactory("BlockRewardHbbft");
  const blockReward = BlockRewardHbbft.attach("0x2000000000000000000000000000000000000001") as BlockRewardHbbft;

  const calldata = blockReward.interface.encodeFunctionData("reward", [true]);

  try {
    const replayTx = {
      from: SystemAccountAddress,
      to: "0x2000000000000000000000000000000000000001",
      gas: "0x4c4b40",
      gasPrice: "0x0",
      value: "0x0",
      data: calldata,
    };

    console.log("tx: ", replayTx)

    const result = await jsonRpcCall("http://62.171.133.46:54100", "eth_call", [
      replayTx,
      "0x6dde3",
    ]);

    console.log(result);
  } catch (e: unknown) {
    const err = e as EthereumCallError;

    console.log(err);

    let revertReason = BlockRewardHbbft.interface.parseError(err.data as any);
    console.log("Revert reason: ", revertReason);
  }
}

async function jsonRpcCall(
  url: string,
  method: string,
  params: any[] = [],
  id: number | string = 1,
): Promise<JsonRpcResponse> {
  const payload: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: method,
    params: params,
    id: id,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const jsonResponse: JsonRpcResponse = await response.json();

  // Handle errors if they exist
  if (jsonResponse.error) {
    throw new EthereumCallError({
      _code: jsonResponse.error.code,
      _message: jsonResponse.error.message,
      _data: jsonResponse.error.data,
    });
  }

  return jsonResponse;
}

triggerReward()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
