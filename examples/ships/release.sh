#!/bin/bash

ROOT_DIR=$(dirname "$0")
cd "$ROOT_DIR"
RELEASE_DIR=rel
FILES=( sprite1.png ../../dabu.css ../../dabu.js ../../assets )

rm game.zip
rm -r "$RELEASE_DIR"

mkdir -p "$RELEASE_DIR"

for file in ${FILES[@]}; do
  cp -a $file ${RELEASE_DIR}/$(basename $file)
done

cat index.html | sed -e 's/\.\.\/\.\.\///g' > $RELEASE_DIR/index.html

cd $RELEASE_DIR

zip -r ../game.zip ./*
