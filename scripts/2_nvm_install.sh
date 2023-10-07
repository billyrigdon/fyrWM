git clone https://github.com/lukechilds/zsh-nvm ~/.oh-my-zsh/custom/plugins/zsh-nvm;
mv ./.zshrc ~/
[ -d ~/.config ] || mkdir ~/.config
mv ./.config/* ~/.config/
source ~/.zshrc
