#!/bin/bash
set -e # exit on error

./get_snapshot.sh > xform/test_snapshot_whiteboard.jpg

cd xform
pipenv run python xform.py
cp background_whiteboard.jpg ../client-data/.

echo "Done transforming image for whiteboard"