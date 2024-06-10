// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { ValueGuards } from "./ValueGuards.sol";
import { ICertifier } from "./interfaces/ICertifier.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { ITxPermission } from "./interfaces/ITxPermission.sol";
import { IKeyGenHistory } from "./interfaces/IKeyGenHistory.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IConnectivityTrackerHbbft } from "./interfaces/IConnectivityTrackerHbbft.sol";

import { DEFAULT_BLOCK_GAS_LIMIT, DEFAULT_GAS_PRICE, MIN_BLOCK_GAS_LIMIT } from "./lib/Constants.sol";
import { ZeroAddress } from "./lib/Errors.sol";

/// @dev Controls the use of zero gas price by validators in service transactions,
/// protecting the network against "transaction spamming" by malicious validators.
/// The protection logic is declared in the `allowedTxTypes` function.
contract TxPermissionHbbft is Initializable, OwnableUpgradeable, ITxPermission, ValueGuards {
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables, do not change their order,
    // and do not change their types!

    address[] internal _allowedSenders;

    /// @dev The address of the `Certifier` contract.
    ICertifier public certifierContract;

    /// @dev
    IKeyGenHistory public keyGenHistoryContract;

    /// @dev A boolean flag indicating whether the specified address is allowed
    /// to initiate transactions of any type. Used by the `allowedTxTypes` getter.
    /// See also the `addAllowedSender` and `removeAllowedSender` functions.
    mapping(address => bool) public isSenderAllowed;

    /// @dev The address of the `ValidatorSetHbbft` contract.
    IValidatorSetHbbft public validatorSetContract;

    /// @dev this is a constant for testing purposes to not cause upgrade issues with an existing network
    /// because of storage modifictions.
    uint256 public minimumGasPrice;

    /// @dev defines the block gas limit, respected by the hbbft validators.
    uint256 public blockGasLimit;

    /// @dev The address of the `ConnectivityTrackerHbbft` contract.
    IConnectivityTrackerHbbft public connectivityTracker;

    // Allowed transaction types mask
    uint32 internal constant NONE = 0;
    uint32 internal constant ALL = 0xffffffff;
    uint32 internal constant BASIC = 0x01;
    uint32 internal constant CALL = 0x02;
    uint32 internal constant CREATE = 0x04;
    uint32 internal constant PRIVATE = 0x08;

    // Function signatures

    // bytes4(keccak256("reportMalicious(address,uint256,bytes)"))
    bytes4 public constant REPORT_MALICIOUS_SIGNATURE = 0xc476dd40;

    // bytes4(keccak256("writePart(uint256,uint256,bytes)"))
    bytes4 public constant WRITE_PART_SIGNATURE = 0x2d4de124;

    // bytes4(keccak256("writeAcks(uint256,uint256,bytes[])"))
    bytes4 public constant WRITE_ACKS_SIGNATURE = 0x5623208e;

    bytes4 public constant SET_VALIDATOR_IP = 0xa42bdee9;

    bytes4 public constant ANNOUNCE_AVAILABILITY_SIGNATURE = 0x43bcce9f;

    // bytes4(keccak256("reportMissingConnectivity(address,uint256,bytes32)"))
    bytes4 public constant REPORT_MISSING_CONNECTIVITY_SELECTOR = 0x911cee74;

    // bytes4(keccak256("reportReconnect(address,uint256,bytes32)"))
    bytes4 public constant REPORT_RECONNECT_SELECTOR = 0xb2a68421;

    // ============================================== Events ==========================================================

    event GasPriceChanged(uint256 _value);
    event BlockGasLimitChanged(uint256 _value);
    event SetConnectivityTracker(address _value);

    error InvalidMinGasPrice();
    error InvalidBlockGasLimit();
    error SenderNotAllowed();
    error AlreadyExist(address _value);
    error NotExist(address _value);
    
    /**
     * @dev Emitted when the minimum gas price is updated.
     * @param _minGasPrice The new minimum gas price.
     */
    event SetMinimumGasPrice(uint256 _minGasPrice);

    /**
     * @dev Emitted when the block gas limit is updated.
     * @param _blockGasLimit The new block gas limit.
     */
    event SetBlockGasLimit(uint256 _blockGasLimit);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    // =============================================== Setters ========================================================

    /// @dev Initializes the contract at network startup.
    /// Can only be called by the constructor of the `Initializer` contract or owner.
    /// @param _allowed The addresses for which transactions of any type must be allowed.
    /// See the `allowedTxTypes` getter.
    /// @param _certifier The address of the `Certifier` contract. It is used by `allowedTxTypes` function to know
    /// whether some address is explicitly allowed to use zero gas price.
    /// @param _validatorSet The address of the `ValidatorSetHbbft` contract.
    /// @param _keyGenHistoryContract The address of the `KeyGenHistory` contract.
    /// @param _contractOwner The address of the contract owner.
    function initialize(
        address[] calldata _allowed,
        address _certifier,
        address _validatorSet,
        address _keyGenHistoryContract,
        address _connectivityTracker,
        address _contractOwner
    ) external initializer {
        if (
            _contractOwner == address(0) ||
            _certifier == address(0) ||
            _validatorSet == address(0) ||
            _keyGenHistoryContract == address(0) ||
            _connectivityTracker == address(0)
        ) {
            revert ZeroAddress();
        }

        __Ownable_init(_contractOwner);

        for (uint256 i = 0; i < _allowed.length; i++) {
            _addAllowedSender(_allowed[i]);
        }

        certifierContract = ICertifier(_certifier);
        validatorSetContract = IValidatorSetHbbft(_validatorSet);
        keyGenHistoryContract = IKeyGenHistory(_keyGenHistoryContract);
        connectivityTracker = IConnectivityTrackerHbbft(_connectivityTracker);
        minimumGasPrice = DEFAULT_GAS_PRICE;
        blockGasLimit = DEFAULT_BLOCK_GAS_LIMIT;

        uint256[] memory minGasPriceAllowedParams = new uint256[](11);
        minGasPriceAllowedParams[0] = 0.1 gwei;
        minGasPriceAllowedParams[1] = 0.2 gwei;
        minGasPriceAllowedParams[2] = 0.4 gwei;
        minGasPriceAllowedParams[3] = 0.6 gwei;
        minGasPriceAllowedParams[4] = 0.8 gwei;
        minGasPriceAllowedParams[5] = 1 gwei;
        minGasPriceAllowedParams[6] = 2 gwei;
        minGasPriceAllowedParams[7] = 4 gwei;
        minGasPriceAllowedParams[8] = 6 gwei;
        minGasPriceAllowedParams[9] = 8 gwei;
        minGasPriceAllowedParams[10] = 10 gwei;

        setAllowedChangeableParameter(
            "setMinimumGasPrice(uint256)",
            "minimumGasPrice()",
            minGasPriceAllowedParams
        );

        uint256[] memory blockGasLimitAllowedParams = new uint256[](10);
        blockGasLimitAllowedParams[0] = 100_000_000;
        blockGasLimitAllowedParams[1] = 200_000_000;
        blockGasLimitAllowedParams[2] = 300_000_000;
        blockGasLimitAllowedParams[3] = 400_000_000;
        blockGasLimitAllowedParams[4] = 500_000_000;
        blockGasLimitAllowedParams[5] = 600_000_000;
        blockGasLimitAllowedParams[6] = 700_000_000;
        blockGasLimitAllowedParams[7] = 800_000_000;
        blockGasLimitAllowedParams[8] = 900_000_000;
        blockGasLimitAllowedParams[9] = 1000_000_000;

        setAllowedChangeableParameter(
            "setBlockGasLimit(uint256)",
            "blockGasLimit()",
            blockGasLimitAllowedParams
        );
    }

    /// @dev Adds the address for which transactions of any type must be allowed.
    /// Can only be called by the `owner`. See also the `allowedTxTypes` getter.
    /// @param _sender The address for which transactions of any type must be allowed.
    function addAllowedSender(address _sender) external onlyOwner {
        _addAllowedSender(_sender);
    }

    /// @dev Removes the specified address from the array of addresses allowed
    /// to initiate transactions of any type. Can only be called by the `owner`.
    /// See also the `addAllowedSender` function and `allowedSenders` getter.
    /// @param _sender The removed address.
    function removeAllowedSender(address _sender) external onlyOwner {
        if (!isSenderAllowed[_sender]) {
            revert NotExist(_sender);
        }

        uint256 allowedSendersLength = _allowedSenders.length;

        for (uint256 i = 0; i < allowedSendersLength; i++) {
            if (_sender == _allowedSenders[i]) {
                _allowedSenders[i] = _allowedSenders[allowedSendersLength - 1];
                _allowedSenders.pop();
                break;
            }
        }

        isSenderAllowed[_sender] = false;
    }

    /// @dev set's the minimum gas price that is allowed by non-service transactions.
    /// IN HBBFT, there must be consens about the validator nodes about wich transaction is legal,
    /// and wich is not.
    /// therefore the contract (could be the DAO) has to check the minimum gas price.
    /// HBBFT Node implementations can also check if a transaction surpases the minimumGasPrice,
    /// before submitting it as contribution.
    /// The limit can be changed by the owner (typical the DAO)
    /// @param _value The new minimum gas price.
    function setMinimumGasPrice(uint256 _value) public onlyOwner {
        // currently, we do not allow to set the minimum gas price to 0,
        // that would open pandoras box, and the consequences of doing that,
        // requires deeper research.
        if (_value == 0) {
            revert InvalidMinGasPrice();
        }

        minimumGasPrice = _value;

        emit GasPriceChanged(_value);
    }

    /// @dev set's the block gas limit.
    /// IN HBBFT, there must be consens about the block gas limit.
    function setBlockGasLimit(uint256 _value) public onlyOwner {
        // we make some check that the block gas limit can not be set to low,
        // to prevent the chain to be completly inoperatable.
        // this value is chosen arbitrarily
        if (_value < MIN_BLOCK_GAS_LIMIT) {
            revert InvalidBlockGasLimit();
        }

        blockGasLimit = _value;

        emit BlockGasLimitChanged(_value);
    }

    function setConnectivityTracker(address _connectivityTracker) external onlyOwner {
        if (_connectivityTracker == address(0)) {
            revert ZeroAddress();
        }

        connectivityTracker = IConnectivityTrackerHbbft(_connectivityTracker);

        emit SetConnectivityTracker(_connectivityTracker);
    }

    // =============================================== Getters ========================================================

    /// @dev Returns the contract's name recognizable by node's engine.
    function contractName() public pure returns (string memory) {
        return "TX_PERMISSION_CONTRACT";
    }

    /// @dev Returns the contract name hash needed for node's engine.
    function contractNameHash() external pure returns (bytes32) {
        return keccak256(abi.encodePacked(contractName()));
    }

    /// @dev Returns the contract's version number needed for node's engine.
    function contractVersion() external pure returns (uint256) {
        return 3;
    }

    /// @dev Returns the list of addresses allowed to initiate transactions of any type.
    /// For these addresses the `allowedTxTypes` getter always returns the `ALL` bit mask
    /// (see https://wiki.parity.io/Permissioning.html#how-it-works-1).
    function allowedSenders() external view returns (address[] memory) {
        return _allowedSenders;
    }

    /// @dev Defines the allowed transaction types which may be initiated by the specified sender with
    /// the specified gas price and data. Used by node's engine each time a transaction is about to be
    /// included into a block. See https://wiki.parity.io/Permissioning.html#how-it-works-1
    /// @param _sender Transaction sender address.
    /// @param _to Transaction recipient address. If creating a contract, the `_to` address is zero.
    /// @param _gasPrice Gas price in wei for the transaction.
    /// @param _data Transaction data.
    /// @return typesMask `uint32 typesMask` - Set of allowed transactions for `_sender` depending on tx `_to` address,
    /// `_gasPrice`, and `_data`. The result is represented as a set of flags:
    /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
    /// 0x02 - contract call;
    /// 0x04 - contract creation;
    /// 0x08 - private transaction.
    /// @return cache `bool cache` - If `true` is returned, the same permissions will be applied from the same
    /// `_sender` without calling this contract again.
    function allowedTxTypes(
        address _sender,
        address _to,
        uint256 /*_value */,
        uint256 _gasPrice,
        bytes memory _data
    ) external view returns (uint32 typesMask, bool cache) {
        // TODO Refactor this function to reduce it's size and avoid future 'stack too deep' error
        // Let the `_sender ` initiate any transaction if the `_sender` is in the `allowedSenders` list
        if (isSenderAllowed[_sender]) {
            return (ALL, false);
        }

        // Get the called function's signature
        bytes4 signature = bytes4(0);
        for (uint256 i = 0; _data.length >= 4 && i < 4; i++) {
            signature |= bytes4(_data[i]) >> (i * 8);
        }

        if (_to == address(validatorSetContract)) {
            // The rules for the ValidatorSet contract
            if (signature == REPORT_MALICIOUS_SIGNATURE) {
                uint256 paramsSize = _data.length - 4 > 64 ? 64 : _data.length - 4;
                bytes memory abiParams = _memcpy(_data, paramsSize, 4);

                (address maliciousMiningAddress, uint256 blockNumber) = abi.decode(abiParams, (address, uint256));

                // The `reportMalicious()` can only be called by the validator's mining address
                // when the calling is allowed
                // slither-disable-next-line unused-return
                (bool callable, ) = validatorSetContract.reportMaliciousCallable(
                    _sender,
                    maliciousMiningAddress,
                    blockNumber
                );
                return (callable ? CALL : NONE, false);
            }

            if (signature == ANNOUNCE_AVAILABILITY_SIGNATURE) {
                return (validatorSetContract.canCallAnnounceAvailability(_sender) ? CALL : NONE, false);
            }

            if (signature == SET_VALIDATOR_IP) {
                address pool = validatorSetContract.stakingByMiningAddress(_sender);
                if (pool != address(0)) {
                    return (
                        IStakingHbbft(validatorSetContract.getStakingContract()).isPoolActive(pool) ? CALL : NONE,
                        false
                    );
                }
                return (NONE, false);
            }

            if (_gasPrice > 0) {
                // The other functions of ValidatorSet contract can be called
                // by anyone except validators' mining addresses if gasPrice is not zero
                return (validatorSetContract.isValidator(_sender) ? NONE : CALL, false);
            }
        }

        if (_to == address(keyGenHistoryContract)) {
            // we allow all calls to the validatorSetContract if the pending validator
            // has to send it's acks and Parts,
            // but has not done this yet.

            if (signature == WRITE_PART_SIGNATURE) {
                if (
                    validatorSetContract.getPendingValidatorKeyGenerationMode(_sender) ==
                    IValidatorSetHbbft.KeyGenMode.WritePart
                ) {
                    //is the epoch parameter correct ?

                    // return if the data length is not big enough to pass a upcommingEpoch parameter.
                    // we could add an addition size check, that include the minimal size of the part as well.
                    if (_data.length < 36) {
                        return (NONE, false);
                    }

                    uint256 epochNumber = _getSliceUInt256(4, _data);

                    if (epochNumber == IStakingHbbft(validatorSetContract.getStakingContract()).stakingEpoch() + 1) {
                        return (CALL, false);
                    } else {
                        return (NONE, false);
                    }
                } else {
                    // we want to write the Part, but it's not time for write the part.
                    // so this transaction is not allowed.
                    return (NONE, false);
                }
            }

            if (signature == WRITE_ACKS_SIGNATURE) {
                if (
                    validatorSetContract.getPendingValidatorKeyGenerationMode(_sender) ==
                    IValidatorSetHbbft.KeyGenMode.WriteAck
                ) {
                    // return if the data length is not big enough to pass a upcommingEpoch parameter.
                    // we could add an addition size check, that include the minimal size of the part as well.
                    if (_data.length < 36) {
                        return (NONE, false);
                    }

                    //is the correct epoch parameter passed ?

                    if (
                        _getSliceUInt256(4, _data) ==
                        IStakingHbbft(validatorSetContract.getStakingContract()).stakingEpoch() + 1
                    ) {
                        return (CALL, false);
                    }

                    // is the correct round passed ? (filters out messages from earlier key gen rounds.)

                    if (
                        _getSliceUInt256(36, _data) ==
                        IStakingHbbft(validatorSetContract.getStakingContract()).stakingEpoch() + 1
                    ) {
                        return (CALL, false);
                    }

                    return (NONE, false);
                } else {
                    // we want to write the Acks, but it's not time for write the Acks.
                    // so this transaction is not allowed.
                    return (NONE, false);
                }
            }

            // if there is another external call to keygenhistory contracts.
            // just treat it as normal call
        }

        if (_to == address(connectivityTracker)) {
            if (signature == REPORT_MISSING_CONNECTIVITY_SELECTOR || signature == REPORT_RECONNECT_SELECTOR) {
                return _handleCallToConnectivityTracker(_sender, signature, _data);
            }

            // if there is another external call to ConnectivityTracker contracts.
            // just treat it as normal call
        }

        //TODO: figure out if this applies to HBBFT as well.
        if (validatorSetContract.isValidator(_sender) && _gasPrice > 0) {
            // Let the validator's mining address send their accumulated tx fees to some wallet
            return (_sender.balance > 0 ? BASIC : NONE, false);
        }

        if (validatorSetContract.isValidator(_to)) {
            // Validator's mining address can't receive any coins
            return (NONE, false);
        }

        // Don't let the `_sender` use a zero gas price, if it is not explicitly allowed by the `Certifier` contract
        if (_gasPrice == 0) {
            return (certifierContract.certifiedExplicitly(_sender) ? ALL : NONE, false);
        }

        // In other cases let the `_sender` create any transaction with non-zero gas price,
        // as long the gas price is above the minimum gas price.
        return (_gasPrice >= minimumGasPrice ? ALL : NONE, false);
    }

    // ============================================== Internal ========================================================

    /// @dev An internal function used by the `addAllowedSender` and `initialize` functions.
    /// @param _sender The address for which transactions of any type must be allowed.
    function _addAllowedSender(address _sender) internal {
        if (_sender == address(0)) {
            revert ZeroAddress();
        }

        if (isSenderAllowed[_sender]) {
            revert AlreadyExist(_sender);
        }

        _allowedSenders.push(_sender);
        isSenderAllowed[_sender] = true;
    }

    /// @dev retrieves a UInt256 slice of a bytes array on a specific location
    /// @param _begin offset to start reading the 32 bytes.
    /// @param _data byte[] to read the data from.
    /// @return uint256 value found on offset _begin in _data.
    function _getSliceUInt256(uint256 _begin, bytes memory _data) internal pure returns (uint256) {
        uint256 a = 0;

        for (uint256 i = 0; i < 32; i++) {
            a = a + (((uint256)((uint8)(_data[_begin + i]))) * ((uint256)(2 ** ((31 - i) * 8))));
        }
        return a;
    }

    function _memcpy(bytes memory src, uint256 len, uint256 offset) internal pure returns (bytes memory) {
        bytes memory result = new bytes(len);

        for (uint256 i = 0; i < len; ++i) {
            result[i] = src[i + offset];
        }

        return result;
    }

    function _handleCallToConnectivityTracker(
        address sender,
        bytes4 selector,
        bytes memory _calldata
    ) internal view returns (uint32 typesMask, bool cache) {
        // 3 x 32 bytes calldata args = 96 bytes
        uint256 paramsSize = _calldata.length - 4 > 96 ? 96 : _calldata.length - 4;
        bytes memory params = _memcpy(_calldata, paramsSize, 4);

        (address validator, uint256 blockNumber, bytes32 blockHash) = abi.decode(params, (address, uint256, bytes32));

        if (selector == REPORT_MISSING_CONNECTIVITY_SELECTOR) {
            uint32 mask = NONE;

            try connectivityTracker.checkReportMissingConnectivityCallable(sender, validator, blockNumber, blockHash) {
                mask = CALL;
            } catch {
                mask = NONE;
            }

            return (mask, false);
        }

        if (selector == REPORT_RECONNECT_SELECTOR) {
            uint32 mask = NONE;

            try connectivityTracker.checkReportReconnectCallable(sender, validator, blockNumber, blockHash) {
                mask = CALL;
            } catch {
                mask = NONE;
            }

            return (mask, false);
        }
    }
}
