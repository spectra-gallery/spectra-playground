// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SpectraLicense
 * @dev Minimal ERC-721 compatible license token. Use OpenZeppelin in production.
 */
interface IERC721Receiver { function onERC721Received(address,address,uint256,bytes calldata) external returns (bytes4); }

contract SpectraLicense {
    string public name = "Spectra License NFT";
    string public symbol = "LIC";
    address public owner;

    struct LicenseMeta {
        string projectId;
        string artifact;     // software / hardware / data / art
        string spdx;         // SPDX identifier (MIT, Apache-2.0, …)
        string uri;          // IPFS/HTTP JSON manifest
    }

    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => LicenseMeta) public meta;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed spender, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor() {
        owner = msg.sender;
    }

    function _transfer(address from, address to, uint256 id) internal {
        require(ownerOf[id] == from, "not owner");
        delete getApproved[id];
        unchecked { balanceOf[from]--; balanceOf[to]++; }
        ownerOf[id] = to;
        emit Transfer(from, to, id);
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(msg.sender == from || msg.sender == getApproved[id] || isApprovedForAll[from][msg.sender], "not approved");
        _transfer(from, to, id);
    }

    function approve(address spender, uint256 id) external {
        address _owner = ownerOf[id];
        require(msg.sender == _owner || isApprovedForAll[_owner][msg.sender], "not owner");
        getApproved[id] = spender;
        emit Approval(_owner, spender, id);
    }

    function setApprovalForAll(address op, bool ok) external {
        isApprovedForAll[msg.sender][op] = ok;
        emit ApprovalForAll(msg.sender, op, ok);
    }

    function mint(address to, LicenseMeta calldata m) external onlyOwner returns (uint256 id) {
        id = ++totalSupply;
        ownerOf[id] = to;
        balanceOf[to]++;
        meta[id] = m;
        emit Transfer(address(0), to, id);
    }
}
