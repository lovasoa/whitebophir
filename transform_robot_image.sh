#!/bin/bash
set -e # exit on error

rm -f client-data/background_whiteboard.jpg
sleep 0.3
./get_snapshot.sh > xform/snapshot_whiteboard.jpg

cd xform
pipenv run python xform.py
mv background_whiteboard.jpg ../client-data/.

echo "Done transforming image for whiteboard"