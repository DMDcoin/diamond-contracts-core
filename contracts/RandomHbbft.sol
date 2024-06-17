// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { BitMaps } from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IRandomHbbft } from "./interfaces/IRandomHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { SYSTEM_ADDRESS } from "./lib/Constants.sol";
import { Unauthorized, ZeroAddress } from "./lib/Errors.sol";

/// @dev Stores and uppdates a random seed that is used to form a new validator set by the
/// `ValidatorSetHbbft.newValidatorSet` function.
contract RandomHbbft is Initializable, OwnableUpgradeable, IRandomHbbft {
    using BitMaps for BitMaps.BitMap;
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!

    /// @dev deprecated slot, was used for randomSeed
    uint256 private deprecated1;

    /// @dev The mapping of random seeds accumulated during RANDAO or another process
    /// (depending on implementation).
    /// blocknumber => random seed
    mapping(uint256 => uint256) private randomHistory;

    BitMaps.BitMap private unhealthiness;

    /// @dev The address of the `ValidatorSet` contract.
    IValidatorSetHbbft public validatorSetContract;

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Validator-Set.html
    modifier onlySystem() virtual {
        if (msg.sender != SYSTEM_ADDRESS) {
            revert Unauthorized();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    function initialize(address _contractOwner, address _validatorSet) external initializer {
        if (_validatorSet == address(0) || _contractOwner == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_contractOwner);

        validatorSetContract = IValidatorSetHbbft(_validatorSet);
    }

    // =============================================== Setters ========================================================

    /// @dev The cooperative consens mechanism in HBBFT achieves to
    /// generate a seed, that cannot be predicted by the nodes,
    /// but can get used within smart contracts without having to wait for
    /// an additional block.
    /// this is one of the biggest benefits of HBBFT.
    /// When the nodes are able to decrypt the transaction,
    /// they know the seed, that can be used as random base for smart contract interactions.
    /// setCurrentSeed is always the first transaction within a block,
    /// and currentSeed is a public available value that can get used by all smart contracts.
    function setCurrentSeed(uint256 _currentSeed) external onlySystem {
        randomHistory[block.number] = _currentSeed;

        if (!validatorSetContract.isFullHealth()) {
            unhealthiness.set(block.number);
        }
    }

    ///@dev returns current random seed
    function currentSeed() external view returns (uint256) {
        return randomHistory[block.number];
    }

    ///@dev returns an array of seeds from requested blocknumbers
    function getSeedsHistoric(uint256[] calldata _blocknumbers) external view returns (uint256[] memory) {
        uint256 len = _blocknumbers.length;
        uint256[] memory output = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            {
                output[i] = randomHistory[_blocknumbers[i]];
            }
        }
        return output;
    }

    ///@dev returns an seed from requested blocknumber
    function getSeedHistoric(uint256 _blocknumber) external view returns (uint256) {
        return randomHistory[_blocknumber];
    }

    function isFullHealth() external view returns (bool) {
        return validatorSetContract.isFullHealth();
    }

    function isFullHealthHistoric(uint256 _blocknumber) external view returns (bool) {
        return !unhealthiness.get(_blocknumber);
    }

    function isFullHealthsHistoric(uint256[] calldata _blocknumbers) external view returns (bool[] memory) {
        uint256 len = _blocknumbers.length;
        bool[] memory output = new bool[](len);
        for (uint256 i = 0; i < len; ) {
            {
                output[i] = !unhealthiness.get(_blocknumbers[i]);
                ++i;
            }
        }
        return output;
    }
}
