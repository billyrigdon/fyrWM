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

```
# Add black arch repos
# Run https://blackarch.org/strap.sh as root and follow the instructions.

$ curl -O https://blackarch.org/strap.sh
# Verify the SHA1 sum

$ echo 5ea40d49ecd14c2e024deecf90605426db97ea0c strap.sh | sha1sum -c
# Set execute bit

$ chmod +x strap.sh
# Run strap.sh

$ sudo ./strap.sh
# Enable multilib following https://wiki.archlinux.org/index.php/Official_repositories#Enabling_multilib and run:

$ sudo pacman -Syu
You may now install tools from the blackarch repository.
# To list all of the available tools, run

$ sudo pacman -Sgg | grep blackarch | cut -d' ' -f2 | sort -u
# To install a category of tools, run

$ sudo pacman -S blackarch-<category>
# To see the blackarch categories, run

$ sudo pacman -Sg | grep blackarch
# To search for a specific package, run

$ pacman -Ss <package_name>
# Note - it maybe be necessary to overwrite certain packages when installing blackarch tools. If
# you experience "failed to commit transaction" errors, use the --needed and --overwrite switches
# For example:

$ sudo pacman -Syyu --needed --overwrite='*' <wanted-package>
```
