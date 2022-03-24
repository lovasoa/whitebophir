#!/bin/bash

# Copy files from another repository to do image transformation to aligh
# a whiteboard snapshot with an annotation screen
# Prerequisites:
#   python3
#   pip
#   pipenv
# need a recent version (as of 2022) of pip in order to install opencv

SRC="../scratchpad/image_alignment"

mkdir -p xform

cp $SRC/Pipfile xform
cp $SRC/xform.py xform

cd xform
pipenv install
