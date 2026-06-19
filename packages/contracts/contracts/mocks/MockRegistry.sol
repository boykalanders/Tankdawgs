// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal stand-in for the DDawgsNFTRegistry — just the `ownsAny`
///         view the gate validates against. `allow` toggles its answer.
contract MockRegistry {
    bool public allow;

    function setAllow(bool v) external {
        allow = v;
    }

    function ownsAny(address) external view returns (bool) {
        return allow;
    }
}
