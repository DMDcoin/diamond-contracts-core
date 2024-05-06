// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.17;

interface IConnectivityTrackerHbbft {
    function reportMissingConnectivity(
        address validator,
        uint256 blockNum,
        bytes32 blockHash
    ) external;

    function reportReconnect(
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) external;

    function checkReportMissingConnectivityCallable(
        address caller,
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) external view;

    function checkReportReconnectCallable(
        address caller,
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) external view;

    function isEarlyEpochEnd(uint256 epoch) external view returns (bool);
}
