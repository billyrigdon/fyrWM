# nodeWM

### (early stages/work in progress)

nodeWM is an experimental x11 window manager written in typescript using electron, vue, and node-x11. This project doen't do anything and is just an early build and not at all ready for use. It is primarily for a future arch-based \(btw\) distribution targeted towards developers but also easy to use for anyone. Also intentionally bloated with all of the tools you'll maybe need one day.The instructions are meant to be run a fresh arch install and are mainly just to install the tools I'm using to build and include in the eventual distribution. Warning: a lot of 3rd party tools.

```
git clone https://github.com/billyrigdon/nodeWM.git;
cd nodeWM/scripts;
```

```
# Run separately:
./0_install_deps.sh;
./1_shell_setup.sh;
./2_nvm_install.sh
./3_node_setup.sh;
```

```
npm install;
npm start;
```

```
# Vim plugins:
vim; # alias for neovim in included dotfiles
:PlugInstall
```
