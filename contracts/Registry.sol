pragma solidity =0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IMetadataRegistry } from "./interfaces/IMetadataRegistry.sol";
import { IOwnerRegistry } from "./interfaces/IOwnerRegistry.sol";
import { IReverseRegistry } from "./interfaces/IReverseRegistry.sol";
import { ZeroAddress } from "./lib/Errors.sol";

/// @dev Stores human-readable keys associated with addresses, like DNS information
/// (see https://wiki.parity.io/Parity-name-registry.html). Needed primarily to store the address
/// of the `TxPermission` contract (see https://wiki.parity.io/Permissioning.html#transaction-type for details).
contract Registry is Ownable, IMetadataRegistry, IOwnerRegistry, IReverseRegistry {
    struct Entry {
        address owner;
        address reverse;
        bool deleted;
        mapping(string => bytes32) data;
    }

    mapping(bytes32 => Entry) internal entries;
    mapping(address => string) internal reverses;

    uint256 public fee = 1 ether;

    event Drained(uint256 amount);
    event FeeChanged(uint256 amount);
    event ReverseProposed(string name, address indexed reverse);

    error InsufficientValue();
    error NotAnOwner();
    error NameAlreadyReserved(bytes32 _name);
    error NameNotExist(bytes32 _name);
    error ReverseNotProposed();

    modifier whenUnreserved(bytes32 _name) {
        if (entries[_name].deleted || entries[_name].owner != address(0)) {
            revert NameAlreadyReserved(_name);
        }
        _;
    }

    modifier onlyOwnerOf(bytes32 _name) {
        if (entries[_name].owner != msg.sender) {
            revert NotAnOwner();
        }
        _;
    }

    modifier whenProposed(string memory _name) {
        if (entries[keccak256(bytes(_name))].reverse != msg.sender) {
            revert ReverseNotProposed();
        }
        _;
    }

    modifier whenEntry(string memory _name) {
        bytes32 nameHash = keccak256(bytes(_name));

        if (entries[nameHash].deleted || entries[nameHash].owner == address(0)) {
            revert NameNotExist(nameHash);
        }
        _;
    }

    modifier whenEntryRaw(bytes32 _name) {
        if (entries[_name].deleted || entries[_name].owner == address(0)) {
            revert NameNotExist(_name);
        }
        _;
    }

    modifier whenFeePaid() {
        if (msg.value < fee) {
            revert InsufficientValue();
        }
        _;
    }

    constructor(address _certifierContract, address _contractOwner) Ownable(_contractOwner) {
        if (_certifierContract == address(0) || _contractOwner == address(0)) {
            revert ZeroAddress();
        }

        bytes32 serviceTransactionChecker = keccak256("service_transaction_checker");

        entries[serviceTransactionChecker].owner = _contractOwner;
        entries[serviceTransactionChecker].data["A"] = bytes20(_certifierContract);

        emit Reserved(serviceTransactionChecker, _contractOwner);
        emit DataChanged(serviceTransactionChecker, "A", "A");
    }

    // Reservation functions
    function reserve(bytes32 _name) external payable whenUnreserved(_name) whenFeePaid returns (bool success) {
        entries[_name].owner = msg.sender;
        emit Reserved(_name, msg.sender);
        return true;
    }

    function transfer(
        bytes32 _name,
        address _to
    ) external whenEntryRaw(_name) onlyOwnerOf(_name) returns (bool success) {
        entries[_name].owner = _to;
        emit Transferred(_name, msg.sender, _to);
        return true;
    }

    function drop(bytes32 _name) external whenEntryRaw(_name) onlyOwnerOf(_name) returns (bool success) {
        if (keccak256(bytes(reverses[entries[_name].reverse])) == _name) {
            emit ReverseRemoved(reverses[entries[_name].reverse], entries[_name].reverse);
            delete reverses[entries[_name].reverse];
        }
        entries[_name].deleted = true;
        emit Dropped(_name, msg.sender);
        return true;
    }

    // Data admin functions
    function setData(
        bytes32 _name,
        string calldata _key,
        bytes32 _value
    ) external whenEntryRaw(_name) onlyOwnerOf(_name) returns (bool success) {
        entries[_name].data[_key] = _value;
        emit DataChanged(_name, _key, _key);
        return true;
    }

    function setAddress(
        bytes32 _name,
        string calldata _key,
        address _value
    ) external whenEntryRaw(_name) onlyOwnerOf(_name) returns (bool success) {
        entries[_name].data[_key] = bytes20(_value);
        emit DataChanged(_name, _key, _key);
        return true;
    }

    function setUint(
        bytes32 _name,
        string calldata _key,
        uint256 _value
    ) external whenEntryRaw(_name) onlyOwnerOf(_name) returns (bool success) {
        entries[_name].data[_key] = bytes32(_value);
        emit DataChanged(_name, _key, _key);
        return true;
    }

    // Reverse registration functions
    function proposeReverse(
        string calldata _name,
        address _who
    ) external whenEntry(_name) onlyOwnerOf(keccak256(bytes(_name))) returns (bool success) {
        bytes32 sha3Name = keccak256(bytes(_name));
        if (
            entries[sha3Name].reverse != address(0) && keccak256(bytes(reverses[entries[sha3Name].reverse])) == sha3Name
        ) {
            delete reverses[entries[sha3Name].reverse];
            emit ReverseRemoved(_name, entries[sha3Name].reverse);
        }
        entries[sha3Name].reverse = _who;
        emit ReverseProposed(_name, _who);
        return true;
    }

    function confirmReverse(
        string calldata _name
    ) external whenEntry(_name) whenProposed(_name) returns (bool success) {
        reverses[msg.sender] = _name;
        emit ReverseConfirmed(_name, msg.sender);
        return true;
    }

    function confirmReverseAs(
        string calldata _name,
        address _who
    ) external whenEntry(_name) onlyOwner returns (bool success) {
        reverses[_who] = _name;
        emit ReverseConfirmed(_name, _who);
        return true;
    }

    function removeReverse() external whenEntry(reverses[msg.sender]) {
        emit ReverseRemoved(reverses[msg.sender], msg.sender);
        delete entries[keccak256(bytes(reverses[msg.sender]))].reverse;
        delete reverses[msg.sender];
    }

    // Admin functions for the owner
    function setFee(uint256 _amount) external onlyOwner returns (bool) {
        fee = _amount;
        emit FeeChanged(_amount);
        return true;
    }

    function drain() external onlyOwner returns (bool) {
        emit Drained(address(this).balance);
        payable(msg.sender).transfer(address(this).balance);
        return true;
    }

    // MetadataRegistry views
    function getData(bytes32 _name, string calldata _key) external view whenEntryRaw(_name) returns (bytes32) {
        return entries[_name].data[_key];
    }

    function getAddress(bytes32 _name, string calldata _key) external view whenEntryRaw(_name) returns (address) {
        return address(bytes20(entries[_name].data[_key]));
    }

    function getUint(bytes32 _name, string calldata _key) external view whenEntryRaw(_name) returns (uint256) {
        return uint256(entries[_name].data[_key]);
    }

    // OwnerRegistry views
    function getOwner(bytes32 _name) external view whenEntryRaw(_name) returns (address) {
        return entries[_name].owner;
    }

    // ReversibleRegistry views
    function hasReverse(bytes32 _name) external view whenEntryRaw(_name) returns (bool) {
        return entries[_name].reverse != address(0);
    }

    function getReverse(bytes32 _name) external view whenEntryRaw(_name) returns (address) {
        return entries[_name].reverse;
    }

    function canReverse(address _data) external view returns (bool) {
        return bytes(reverses[_data]).length != 0;
    }

    function reverse(address _data) external view returns (string memory) {
        return reverses[_data];
    }

    function reserved(bytes32 _name) external view whenEntryRaw(_name) returns (bool) {
        return entries[_name].owner != address(0);
    }
}
