pragma solidity =0.8.17;

import "./interfaces/IBlockRewardHbbft.sol";
import "./interfaces/ICertifier.sol";
import "./interfaces/IKeyGenHistory.sol";
import "./interfaces/IRandomHbbft.sol";
import "./interfaces/IStakingHbbft.sol";
import "./interfaces/ITxPermission.sol";
import "./interfaces/IValidatorSetHbbft.sol";

/// @dev Used once on network startup and then destroyed.
/// Needed for initializing upgradeable contracts since
/// upgradeable contracts can't have constructors.
contract InitializerHbbft {
    /// @param _contracts An array of the contracts:
    ///   0 is ValidatorSetHbbft,
    ///   1 is BlockRewardHbbft,
    ///   2 is RandomHbbft,
    ///   3 is StakingHbbft,
    ///   4 is TxPermission,
    ///   5 is Certifier,
    ///   6 is KeyGenHistory.
    /// @param _owner The contracts' owner.
    /// @param _miningAddresses The array of initial validators' mining addresses.
    /// @param _stakingAddresses The array of initial validators' staking addresses.
    /// @param _stakingParams list of staking related parameters, done to avoid "stack too deep" error
    /// _stakingParams[0]: _delegatorMinStake The minimum allowed amount of delegator stake in Wei
    /// (see the `StakingHbbft` contract).
    /// _stakingParams[1]: _candidateMinStake The minimum allowed amount of candidate stake in Wei
    /// (see the `StakingHbbft` contract).
    /// _stakingParams[2]: _stakingEpochDuration The duration of a staking epoch.
    /// _stakingParams[3]: _stakingTransitionTimeframeLength Length of the timeframe in seconds for the transition
    /// _stakingParams[4]: _stakingWithdrawDisallowPeriod The duration period (in blocks) at the end of a staking epoch
    /// during which participants cannot stake or withdraw their staking tokens
    /// @param _publicKeys bytes32[] memory
    /// @param _internetAddresses bytes16[] memory
    /// @param _parts bytes[] memory
    /// @param _acks bytes[][] memory
    constructor(
        address[] memory _contracts,
        address _owner,
        address[] memory _miningAddresses,
        address[] memory _stakingAddresses,
        uint256[6] memory _stakingParams,
        bytes32[] memory _publicKeys,
        bytes16[] memory _internetAddresses,
        bytes[] memory _parts,
        bytes[][] memory _acks
    ) public {
        IValidatorSetHbbft(_contracts[0]).initialize(
            _contracts[1], // _blockRewardContract
            _contracts[2], // _randomContract
            _contracts[3], // _stakingContract
            _contracts[6], // _keyGenHistoryContract
            _miningAddresses,
            _stakingAddresses
        );
        IStakingHbbft(_contracts[3]).initialize(
            IStakingHbbft.StakingParams({
                _validatorSetContract: _contracts[0], // _validatorSetContract
                _initialStakingAddresses: _stakingAddresses,
                _delegatorMinStake: _stakingParams[0], // _delegatorMinStake
                _candidateMinStake: _stakingParams[1], // _candidateMinStake
                _maxStake: _stakingParams[2], // _maxStake
                _stakingFixedEpochDuration: _stakingParams[3], // _stakingEpochDuration
                _stakingTransitionTimeframeLength: _stakingParams[4], // _stakingTransitionTimeframeLength
                _stakingWithdrawDisallowPeriod: _stakingParams[5] // _stakingWithdrawDisallowPeriod
            }),
            _publicKeys,
            _internetAddresses
        );
        IKeyGenHistory(_contracts[6]).initialize(
            _contracts[0], // _validatorSetContract
            _miningAddresses,
            _parts,
            _acks
        );
        IBlockRewardHbbft(_contracts[1]).initialize(_contracts[0]);
        address[] memory permittedAddresses = new address[](1);
        permittedAddresses[0] = _owner;

        ICertifier(_contracts[5]).initialize(permittedAddresses, _contracts[0]);
        ITxPermission(_contracts[4]).initialize(
            permittedAddresses,
            _contracts[5],
            _contracts[0],
            _contracts[6]
        );

        if (block.number > 0) {
            selfdestruct(payable(msg.sender));
        }
    }

    function destruct() external {
        selfdestruct(payable(msg.sender));
    }
}
