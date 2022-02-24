toio-mrmp
---

[toio](https://toio.io/) robots controller, used in [SSSP](https://kei18.github.io/sssp).
It is written in Node.js with [yarn](https://yarnpkg.com/) build and tested on MacOS 10.15.
This repo works with [toio-raspi-edge-controller](https://github.com/Kei18/toio-raspi-edge-controller) and [SSSP](https://github.com/Kei18/sssp).

## Install

```sh
git clone https://github.com/Kei18/toio-mrmp.git
cd toio-mrmp
yarn install
yarn build
```

## Usage

```sh
yarn run solve -i ./instances/4x4.yaml -s -k 2
```

You can find details for parameters with:

```sh
sudo node ./src/edge_controller.js --help
```

## Notes

- This repository is forked from [toio.js](https://github.com/toio/toio.js). To make the repo private temporarily, I duplicate the original repo.

## Licence

This software is released under the MIT License, see [LICENCE.txt](LICENCE.txt).

## Author

[Keisuke Okumura](https://kei18.github.io) is a Ph.D. student at Tokyo Institute of Technology, interested in controlling multiple moving agents.
