# Bundled language toolsets and dependencies
sudo pacman -S --noconfirm less zsh networkmanager base-devel git vivaldi htop ansible curl wget openjdk17-src dotnet-sdk xorg docker docker-compose chromium epiphany neovim tmux make gcc valgrind clang python python-pip ruby maven gradle go rust rustup php php-apache android-tools android-udev code intellij-idea-community-edition go gnome-boxes 

#Install yay
pacman -S --noconfirm --needed git base-devel && git clone https://aur.archlinux.org/yay-bin.git && cd yay-bin && makepkg -si

# AUR packages
yay -S --noconfirm pfetch microsoft-edge-stable-bin google-chrome 

# Snaps you want
sudo systemctl enable --now snapd
sudo snap install signal-desktop
sudo snap install bitwarden
sudo snap install firefox
sudo snap install android-studio --classic

# Install neovim plugin manager
sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \\n       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'


