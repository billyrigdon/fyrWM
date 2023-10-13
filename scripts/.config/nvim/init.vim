call plug#begin('~/.config/nvim/plugged') 
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'preservim/nerdtree'
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-fugitive'
Plug 'HerringtonDarkholme/yats.vim'
Plug 'leafOfTree/vim-vue-plugin'
Plug 'dracula/vim', { 'as': 'dracula' }
Plug 'jiangmiao/auto-pairs'

call plug#end()

map <C-n> :NERDTreeToggle<CR>
set tabstop=2
set shiftwidth=2
set expandtab
colorscheme dracula
inoremap <silent><expr> <TAB> pumvisible() ? "\<C-y>" : "\<TAB>"

