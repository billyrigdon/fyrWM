# fyrWM

### (early stages/work in progress)

fyrWM \(frick your ram\) is an x11 tiling window manager written in typescript using electron, vue, and node-x11. This is an early build and not at all ready for use. It is primarily for a future arch-based \(btw\) distribution targeted towards developers but also easy to use for anyone. Also intentionally bloated with all of the tools you'll maybe need one day.

The instructions are meant to be run a fresh arch install and are mainly just to install the tools I'm using to build and include in the eventual distribution. Warning: a lot of 3rd party tools.

```
#Clone repo
git clone https://github.com/billyrigdon/nodeWM.git;
cd nodeWM/scripts;
```

```
# Run separately \(changes your shell and installs a buttload of deps and tools\)
./0_install_deps.sh;
./1_shell_setup.sh;
./2_nvm_install.sh
./3_node_setup.sh;
```

```
# Install dependencies and build project
cd ../fyrWM;
npm install;
npm run build;
```

```
# Back up xinitrc
mv ~/.xinitrc ~/.xinitrc.old
```

```
# From tty console, with no other WM running
echo "/path/to/electron /path/to/project/folder/" > ~/.xinitrc
startx;
```

```
# Project configs and logs located at: ~/.fyr/
```
