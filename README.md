massive-toio
---

[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE)

[toio](https://toio.io/) robots controller.
It is written in Node.js with [yarn](https://yarnpkg.com/) build and tested on MacOS 10.15.

- This repository is used in a paper ["xxxx"](https://kei18.github.io/mrmp).
- This repository is forked from [toio.js](https://github.com/toio/toio.js). To make the repo private temporarily, I duplicate the original repo.

## Demo

![toio](./material/sample.gif)

## Install

```sh
git clone {}
cd toio-exec
yarn install
yarn build
```

## Usage

```sh
yarn run serve -i ./instances/4x4.yaml -s -k 2
```

## Licence

This software is released under the MIT License, see [LICENCE.txt](LICENCE.txt).

## Author

[Keisuke Okumura](https://kei18.github.io) is a Ph.D. student at the Tokyo Institute of Technology, interested in controlling multiple moving agents.
