pragma solidity =0.8.17;

contract Sacrifice {
    constructor(address payable _recipient) payable {
        selfdestruct(_recipient);
    }
}
