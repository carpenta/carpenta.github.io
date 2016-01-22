---
title:  "Mac OSX 10.8+, Install Ruby on Rails"
date:   2016-01-22 01:11:00
description: "RoR 개발을 하고 싶어서 설치한다.."
layout: post
tags: 
- osx
- ror
- ruby
---

# RoR 배우기

용감한 사자가 페이스북에서 종종 보이길레 뭔가 해서 봤더니...
웹서비스를 개발하는 방법을 알려주는 좋은 가이드페이지를 제공하고 있었다. [참고](http://www.codelion.net/)

rails 는 언젠가 한번 꼭 써봐야지 했던 터라, 얼마나 빨리 개발이 가능하길레 그리 인기가 좋은지 한번 체험해 보기로 했다.
먼저 ruby 언어를 좀 둘러보고... [ruby 한국어 메뉴얼](https://www.ruby-lang.org/ko/)

그리고 rails 도 공식사이트로 보고.. [rails 공식 페이지](http://rubyonrails.org/)

그리고 영 감이 안잡혀서 [codecademy](https://www.codecademy.com/) 에서 살짝 공부도 해봤다. 
그런데 오히려 디테일은 페이스북 그룹이 더 있더라... 허허 [facebook RoR,Korea 그룹](https://www.facebook.com/groups/rubyonrailskorea/)
요기 위에 있는 링크들을 보다보면 지속적으로 정보를 얻을 수 있을 것 같다.


# 설치를 위한 삽질..

언제나 그렇듯 삽질의 시작은 설치다.
mac os 엘케피탄이라는 못난 os 를 쓰고 있는데, 기본적으로 ruby 가 설치되어 있다. 뭔가 일이 술술 풀릴때는 언제나 불안한 기분이 드는것은 왜일까?
이럴땐 분명 삽질 포인트가 있다.

자 그러면 ruby 도 깔려 있겠다. 발빠르게 rails 를 시작해볼까?
vi 로부터 개발을 시작하고 커멘드라인을 활용하는것이 아름다웠겠지만, 무언가 폼나는 화면이 그리웠던 나는.. ide 라는 사치를 부려보기로 한다.

rails 공식 페이지에서 ide 링크를 하나 던져 주길레, 평소 호감을 가지고 있던 jetbrain 에서 만든 [RubyMine](https://www.jetbrains.com/ruby/) 이라는 녀석을 덜컥 다운로드했다.
그리고 설치... 자비롭게도 30일 무료다.
rails application 형태로 프로젝트를 생성하려 하니, 아름답게 rails 가 설치되어 있지 않으니, 설치할 녀석을 골라보라고 안내해주고 있었다.
stable version 을 rails 공식 페이지에서 찾아서 선택하고 설치시작. 모든것이 평화로웠고, 커피를 한잔 내려서 돌아와 보니 붉은 에러메시지들이 화면을 채우고 있었다.
문제는 찾아보지 않았지만, 뭔가 기본설치되어 있는 ruby version 과 rails 버전이 안맞거나 한것 같았다. 몇번 더 다른버전으로 돌려보고... 뭔가 불길한 느낌이 들었다.

mac os 기본 ruby version 이 2.0.0 이 설치되어 있었는데, 현재 ruby stable version 은 2.3.0 이었다.
기본 설치된 ruby 를 지울 수 있을 줄 알고, rm 명령을 날려봤지만, system 에서 사용한덴다... 허허.. 미안. 난 포기가 빠른 남자.
stackoverflow 형에게 물어봤더니.. [rvm](https://rvm.io/) 이나 rbenv 같은 ruby 설치버전 관리 툴들이 있다고 한다.
rvm 이 더 간편해 보여서 rvm 을 설치했다.

{% highlight Bash shell scripts %}
\curl -sSL https://get.rvm.io | bash -s stable
{% endhighlight %}

curl 은 아름답다.

멋지게 순차적으로 설치와 안내메시지가 등장하고 막을 내렸다.

{% highlight Bash shell scripts %}
rvm install 2.3.0
rvm --default use 2.3.0
{% endhighlight %}

기본적으로 사용할 ruby 를 바꾸어 주었다.

{% highlight Bash shell scripts %}
sudo gem install rails
{% endhighlight %}

드디어 감동의 rails 설치다.
매우 많은 gem library 들이 설치되면서 rails 가 설치되고 있었다. autoconf, automake 도 없었어서, 이거 설치하느라 설치시간이 좀더 소요된건 창피하니까 없던 일로해두자..
뭔가 많이 설치되었는데, 무슨 기능을 하는지 잘 모르겠어서 좀 민망했다. 나중에 알게되겠지라는 마음으로 덮어둔다...(나란남자 대강대강 사는 남자 -_-;; 허허)


```
ruby -e $stdout.sync=true;$stderr.sync=true;load($0=ARGV.shift) rails _4.2.5_ new ~/myblog --javascript=jquery --skip --database=sqlite3
       exist  
      create  README.rdoc
      create  Rakefile
      create  config.ru
      create  .gitignore
      create  Gemfile
      create  app
      create  app/assets/javascripts/application.js
      create  app/assets/stylesheets/application.css
      create  app/controllers/application_controller.rb
      create  app/helpers/application_helper.rb
      create  app/views/layouts/application.html.erb
      create  app/assets/images/.keep
      create  app/mailers/.keep
      create  app/models/.keep
      create  app/controllers/concerns/.keep
      create  app/models/concerns/.keep
      create  bin
      create  bin/bundle
      create  bin/rails
      create  bin/rake
      create  bin/setup
      create  config
      create  config/routes.rb
      create  config/application.rb
      create  config/environment.rb
      create  config/secrets.yml
      create  config/environments
      create  config/environments/development.rb
      create  config/environments/production.rb
      create  config/environments/test.rb
      create  config/initializers
      create  config/initializers/assets.rb
      create  config/initializers/backtrace_silencers.rb
      create  config/initializers/cookies_serializer.rb
      create  config/initializers/filter_parameter_logging.rb
      create  config/initializers/inflections.rb
      create  config/initializers/mime_types.rb
      create  config/initializers/session_store.rb
      create  config/initializers/wrap_parameters.rb
      create  config/locales
      create  config/locales/en.yml
      create  config/boot.rb
      create  config/database.yml
      create  db
      create  db/seeds.rb
      create  lib
      create  lib/tasks
      create  lib/tasks/.keep
      create  lib/assets
      create  lib/assets/.keep
      create  log
      create  log/.keep
      create  public
      create  public/404.html
      create  public/422.html
      create  public/500.html
      create  public/favicon.ico
      create  public/robots.txt
      create  test/fixtures
      create  test/fixtures/.keep
      create  test/controllers
      create  test/controllers/.keep
      create  test/mailers
      create  test/mailers/.keep
      create  test/models
      create  test/models/.keep
      create  test/helpers
      create  test/helpers/.keep
      create  test/integration
      create  test/integration/.keep
      create  test/test_helper.rb
      create  tmp/cache
      create  tmp/cache/assets
      create  vendor/assets/javascripts
      create  vendor/assets/javascripts/.keep
      create  vendor/assets/stylesheets
      create  vendor/assets/stylesheets/.keep
         run  bundle install
```

이쁘게 나온다... 이맛에 ide 쓰는거 같다..

![생성성공]({{site.url}}/assets/MacOSX-ror-install/ide-success-screenshot-0.png)


자 그럼.. 개발 삽질은 다음 포스팅에..
