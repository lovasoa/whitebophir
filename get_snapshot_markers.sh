#!/bin/bash
set -e # exit on error

sleep 0.5
./get_snapshot.sh > xform/snapshot_markers.jpg

echo "Done getting snapshot with markers"