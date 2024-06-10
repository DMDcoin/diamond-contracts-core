pragma solidity =0.8.25;

address constant SYSTEM_ADDRESS = 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE;

uint256 constant DEFAULT_GAS_PRICE = 1 gwei;
uint256 constant DEFAULT_BLOCK_GAS_LIMIT = 1_000_000_000; // 1 giga gas block
uint256 constant MIN_BLOCK_GAS_LIMIT = 1_000_000;

uint256 constant MIN_VALIDATOR_INACTIVITY_TIME = 1 weeks;
