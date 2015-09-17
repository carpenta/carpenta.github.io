---
title:  "Vim - Vundle로 강화하기" 
date:   2015-09-17 11:28:00
description: "Vim - Vundle 로 강화하기"
layout: post
tags: 
- vim
- tool
---

# Vim
Vim 에 대한 설명이 필요하다면 위키를 보는게 좋겠다.
대신 vim 관련 유용한 사이트 몇개를 기록한다. 

- [Reddit/vim](http://www.reddit.com/r/vim/) : vim 관련 뉴스
- [Reddit/neovim](http://www.reddit.com/r/neovim/) : neovim 관련 뉴스
- [VimAwesome](http://vimawesome.com/) : vim plugin 정보
- [usevim](http://usevim.com/) : tip 정보

# Vundle 의 설치
Vundle 은 vim 의 플러그인을 관리 해주는 툴중 하나이다. [Vundle 프로젝트](https://github.com/VundleVim/Vundle.vim) 에 들어가보면 자세한 설명과 설치방법에 대해 나와있는다. 간단한 설치 과정을 여기도 기록한다.

## git clone Vundle

{% highlight Bash shell scripts %}
$ # mkdir -p ~/.vim/bundle	#디렉토리 없으면 생성..
$ cd ~/.vim/bundle 
$ git clone https://github.com/VundleVim/Vundle.vim.git
{% endhighlight %}

## ~/.vimrc 수정
아래 내용은 Vundle github readme 에 기록된 내용을 그대로 복사. 예시로 플러그인 몇개를 기본적으로 기록해 놓은 것을 가져왔다.

{% highlight Vim Script %}
set nocompatible              " be iMproved, required
filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'VundleVim/Vundle.vim'

" The following are examples of different formats supported.
" Keep Plugin commands between vundle#begin/end.
" plugin on GitHub repo
Plugin 'tpope/vim-fugitive'
" plugin from http://vim-scripts.org/vim/scripts.html
Plugin 'L9'
" Git plugin not hosted on GitHub
Plugin 'git://git.wincent.com/command-t.git'
" git repos on your local machine (i.e. when working on your own plugin)
Plugin 'file:///home/gmarik/path/to/plugin'
" The sparkup vim script is in a subdirectory of this repo called vim.
" Pass the path to set the runtimepath properly.
Plugin 'rstacruz/sparkup', {'rtp': 'vim/'}
" Avoid a name conflict with L9
Plugin 'user/L9', {'name': 'newL9'}

" All of your Plugins must be added before the following line
call vundle#end()            " required
filetype plugin indent on    " required
" To ignore plugin indent changes, instead use:
"filetype plugin on
"
" Brief help
" :PluginList       - lists configured plugins
" :PluginInstall    - installs plugins; append `!` to update or just :PluginUpdate
" :PluginSearch foo - searches for foo; append `!` to refresh local cache
" :PluginClean      - confirms removal of unused plugins; append `!` to auto-approve removal
"
" see :h vundle for more details or wiki for FAQ
" Put your non-Plugin stuff after this line
{% endhighlight %}

## Install!!!
vundle 을 활성화 하기 위해서는 vim 을 실행하고 cmd 모드에서 PluginInstall 명령을 실행한다.

	$ vim # 일단 빔을 열고
	:PluginInstall

	#$ vim +PluginInstall +qall #요렇게 해도 된다고 한다.

![실행 결과]({{site.url}}/assets/vim-vundle/vim-vundle-1.png)

실행 결과에 에러나는 건수가 좀 있다. 에러나는 플러그인들은 과감히 버리자. 


## 자 이제 쓸만한게 뭐가 있을지 볼가...
VimAwesome 에서 탑랭크 몇가지에서 쓸만해 보이는걸 골라봤다. 다시 수정한 vimrc 는 아래와 같다.

- [The NERD Tree](http://vimawesome.com/plugin/the-nerd-tree)
- [surround.vim](http://vimawesome.com/plugin/surround-vim)
- [vim-markdown](http://vimawesome.com/plugin/vim-markdown-safe-and-sound)

{% highlight Vim Script %}
set nocompatible              " be iMproved, required
filetype off                  " required
syntax on

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'VundleVim/Vundle.vim'

" The following are examples of different formats supported.
" Keep Plugin commands between vundle#begin/end.
" plugin on GitHub repo
Plugin 'tpope/vim-fugitive'
" plugin from http://vim-scripts.org/vim/scripts.html
Plugin 'L9'
" The sparkup vim script is in a subdirectory of this repo called vim.
" Pass the path to set the runtimepath properly.
Plugin 'rstacruz/sparkup', {'rtp': 'vim/'}

" All of your Plugins must be added before the following line
call vundle#end()            " required
filetype plugin indent on    " required
" To ignore plugin indent changes, instead use:
"filetype plugin on
"
" Brief help
" :PluginList       - lists configured plugins
" :PluginInstall    - installs plugins; append `!` to update or just :PluginUpdate
" :PluginSearch foo - searches for foo; append `!` to refresh local cache
" :PluginClean      - confirms removal of unused plugins; append `!` to auto-approve removal
"
" see :h vundle for more details or wiki for FAQ
" Put your non-Plugin stuff after this line
"
Plugin 'tpope/vim-surround'
Plugin 'scrooloose/nerdtree'
Plugin 'tpope/vim-markdown'
{% endhighlight %}

자 이제 다시 플러그인 설치!

	:PluginClean
	:PluginInstall

## 끝~ 기념으로 NerdTree 한번 열어보고

![설치하고 NerdTree]({{site.url}}/assets/vim-vundle/vim-vundle-2.png)
