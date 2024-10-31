import { BlockRewardHbbft, ConnectivityTrackerHbbft, ValidatorSetHbbft } from "../src/types";
import { ethers } from "hardhat";

async function getNetworkState() {
  const ValidatorSetHbbft = await ethers.getContractFactory("ValidatorSetHbbft");
  const validatorSet = ValidatorSetHbbft.attach("0x1000000000000000000000000000000000000001") as ValidatorSetHbbft;

  const ConnectivityTracker = await ethers.getContractFactory("ConnectivityTrackerHbbft");
  const connectivityTracker = ConnectivityTracker.attach(
    "0x1200000000000000000000000000000000000001"
  ) as ConnectivityTrackerHbbft;

  const BlockRewardHbbft = await ethers.getContractFactory("BlockRewardHbbft");
  const blockReward = BlockRewardHbbft.attach("0x2000000000000000000000000000000000000001") as BlockRewardHbbft;

  const epoch = await connectivityTracker.currentEpoch({ blockTag: 450000n });
  console.log("[epoch] current epoch: ", await connectivityTracker.currentEpoch());
  console.log("[epoch] epoch faulty validators: ", await connectivityTracker.countFaultyValidators(epoch));
  console.log("[epoch] epoch - 1 faulty validators: ", await connectivityTracker.countFaultyValidators(epoch - 1n));
  console.log("[epoch] epoch - 2 faulty validators: ", await connectivityTracker.countFaultyValidators(epoch - 2n));

  console.log("[validators] current: ", await validatorSet.getValidators());
  console.log("[validators] pending: ", await validatorSet.getPendingValidators());
  console.log("[validators] previous: ", await validatorSet.getPreviousValidators());

  const prevValidators = await validatorSet.getPreviousValidators();

  for (const validator of prevValidators) {
    console.log("\nvalidator: ", validator);
    console.log("score epoch N: ", await connectivityTracker.getValidatorConnectivityScore(epoch, validator));
    console.log("score epoch N-1: ", await connectivityTracker.getValidatorConnectivityScore(epoch - 1n, validator));
  }

  console.log("[block reward] fixed reward rate: ", await blockReward.VALIDATOR_FIXED_REWARD_PERCENT());
  console.log("[block reward] conn tracker: ", await blockReward.connectivityTracker());
  console.log("[conn tracker] bonus score system: ", await connectivityTracker.bonusScoreContract());

  console.log("[validator set] connectivityTracker: ", await validatorSet.connectivityTracker());
  console.log("[validator set] get staking: ", await validatorSet.getStakingContract());

  console.log("[conn tracker] flagged count: ", await connectivityTracker.getFlaggedValidatorsByEpoch(epoch));
  console.log(
    "[conn tracker] flagged count epoch-1: ",
    await connectivityTracker.getFlaggedValidatorsByEpoch(epoch - 1n)
  );

  console.log("[block reward] min validator reward: ", await blockReward.validatorMinRewardPercent(epoch));

  for (let block = 449000n; block <= 450019n; block = block + 1n) {
    console.log(`block: ${block} -> early epoch end ${await blockReward.earlyEpochEnd({ blockTag: block })}`);
    console.log(`block: ${block} -> current validators ${await validatorSet.getValidators({ blockTag: block })}`);
  }

  console.log("pending: ", await validatorSet.getPendingValidators({ blockTag: 450009n }));

  for (const validator of prevValidators) {
    console.log(
      `${validator}            available since: ${await validatorSet.validatorAvailableSince(validator, {
        blockTag: 450019n,
      })}`
    );
    console.log(
      `${validator} available since last write: ${await validatorSet.validatorAvailableSinceLastWrite(validator, {
        blockTag: 450019n,
      })}`
    );
  }
}

getNetworkState()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
