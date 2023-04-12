#!/usr/bin/env bash

rm -rf flat/*
ROOT=contracts/
UPGRADEABILITY=upgradeability/
UPGRADEABILITY_FULL="$ROOT""$UPGRADEABILITY"
FLAT=flat/

FULLPATH="$(cd "$(dirname "$1")"; pwd -P)/$(basename "$1")"

iterate_sources() {
    for FILE in "$FULLPATH""$1"*.sol; do
        [ -f "$FILE" ] || break
        echo $FILE
        npx hardhat flatten $FILE > $2"$(basename -- $FILE)"
    done
}

mkdir -p $FLAT$UPGRADEABILITY;
iterate_sources $ROOT $FLAT

iterate_sources $UPGRADEABILITY_FULL $FLAT$UPGRADEABILITY
