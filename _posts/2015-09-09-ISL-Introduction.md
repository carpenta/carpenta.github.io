---
title:  "ISL - 1. Introduction"
date:   2015-09-09 20:18:00
description: "'An Introduction to Statistical Learning' 1장 Introduction 공부"
layout: post
tags: 
- statistics
- machine learning
- study
---

# 1장의 구성
대부분의 전문서적, 기술서적이 그러하듯이 첫장은 소개로 시작한다. 
책의 전반적인 이야기와 사용하는 용어 및 수식등 표기방법에 대해서 이야기 하고, 
기계학습과 관련이 있는 책인만큼 사용하는 데이터 셋에 대해서도 간략하게 소개한다.

	Overview
		3개의 예제 데이터 셋
			Wage, 
			Stock Market, 
			Gene Expression 
		Statistical Learning 의 간편한 역사소개
	이 책에 대해서 소개
		누가 이 책을 읽어야 할까?
		용어와 등장하는 수식표현 방법에 대한 소개
		책의 구성(생략)
		사용하는 데이터셋과 출처
		웹사이트(생략)

## Overview
먼저 *'Statistical learning'* 의 의미를 간략히 언급한다.

> 통계적 학습은 데이터를 이해하는 방대한 방법의 집합이다.
> (Statistical learning refers to a vast set of tools for understanding data.)

통계적 학습의 두가지 종류에 대해서도 가볍게 다룬다. 좀더 자세한 설명은 [coursera machine learning 강의](https://class.coursera.org/ml-003/lecture/3)를 참고 하는 것이 좋겠다.

> 통계적 학습은 크게 *supervised* 와 *unsupervised* 로 나눌 수 있다. 
> supervised 는 여러개의 미리 준비된 입력 및 결과값을 기반으로 대한 결과값에 대해서 결과를 예측, 추정하는 통계적 모델을 만드는 형태이다.
> 반면 unsupervised 는 입력값만을 가지고 각 데이터 사이의 관계와 구조에 대해서 학습하는 형태로 설명한다.

그리고 맛보기를 위해서 셈플 데이터셋 3개를 대상으로 몇가지 데이터 특성에 대해 설명한다.
(해당 데이터의 출처는 뒤부분에 나온다)

### Data Sets
셈플 데이터셋을 보여주면서 설명을 이어 나가는 이유는 각 데이터마다 특성이 다르고 먼저는 데이터에서 요소(factor) 를 꺼낼 수 있는 눈이 먼저 있어야 하기 때문인 것 같다. 
데이터의 형태마다 어떤 시각으로 접근하고 다룰지에 대해서 이야기 해주려고 한 듯 하다.

* Wage Data : `which contains income survey information for males from the central Atlantic region of the United States.`
이 데이터는 나이, 년도, 교육레벨, 임금으로 구성된 데이터이다.
나이를 통해 임금을 예측해 보거나,
임금은 year, education 에 관련된 함수라는 점을 찾아 볼 수 있다. 
이 데이터를 통해 선형관계, 비선형 관계에 대해서 학습해볼 예정이다. (Regression 문제용)

* Stock Market Data : Wage Data 가 연속적인 결과값(임금은 0~무한대)을 가지는 것에 반해서 Stock Market Data 의 결과값이 몇가지로 나누어 지는 형태이다(`categorical` or `qualitative`).
4장에서 다룰 것이고, 분류문제 학습용도로 쓴다.

* Gene Expression Data : 앞의 두 데이터가 입력 및 결과값을 모두 가지는데 반해서 이 데이터는 결과값이 없다. 
10장 unsupervised 학습방법에 대한 데이터로 쓴다.


### 간단한 역사
기술 발전 속도가 빨라지면 빨라질수록 역사를 아는게 중요하다는 생각이 든다. 
무심코 유명한 최신버전이 제품이 제일 좋은 거겠지 하고 잘 알지 못하는 기술을 도입 했다가는... 
세부 설정이나, 응용에서 낭폐를 겪는다.
사실 이 공부를 시작한 이유중 하나도 이런 낭폐감 때문이다.
잘 만들어진 프레임워크를 사용하는 것은 손쉽다.
하지만 기반지식이나 해당 기술에 대한 역사이해가 없으면 
조그마한 응용이나 버그 수정도 엄두를 낼 수가 없다. 
넉두리는 이만 접어두고 본론으로 들어가자.
`statical learning` 이란 용어가 그리 오래전부터 사용된 것은 아니다. 
하지만 관련된 지식은 매우 오래전부터 개발되었다고 한다.

> 19세기 *Legendre* 와 *Gauss* 가 내놓은 `method of least squares` 라는 논문은 `linear regression` 의 초기내용과 같다고 한다. 이후 1936년에 `linear discriminant analysis` 가 *Fisher* 에 의해서 제안되었고, 1940년대에 `logistic regression` 이 작성되었다. 

> 1970년대 초반에 *Nelder* 와 *Wedderburn* 이 `generalized linear model` 이라는 방법을 만들었다. 1970년대 말까지 선형 데이터에 대해서만 분석이 가능했는데, 비선형 관계에 대해서는 컴퓨터가 아직 덜 발전해서 계산하기 어려웠기 때문이다. 

> 1980년대 중반 *Breiman*, *Friedman*, *Olshen*, *Stone* 이 `classification and regression trees` 를 소개했고, `cross-validation` 같은 강력한 모델 선택 방법도 이야기 했다. 

> 1986년에 비선형 데이터를 다룰 수 있는 `generalized additive models` 를 *Hastie* 와 *Tibshirani* 가 발표했다. 그리고 `machine learning` 이 태동했다. 

> 통계학의 하위 학문으로 통계적 학습이 생겼다. 오늘날에는 이러한 통계적 작업을 쉽게 해주는 `R` 같은 녀석도 생겼다.

## 책에 대한 전반적인 소개
`The Elements of Statistical Learning (ESL) by Hastie, Tibshirani, Friedman` 이 2001년에 출간되었고, 
이쪽분야에서 기초가 되는 참조서적으로 쓰였다고 한다. 
1990년대에 들어서면서 컴퓨터의 성능이 급격하게 증가했고 실용적 분야의 발전이 거듭되었고, 응용분야에 집중되었다.
반면 ISL 의 목적은 통계적 학습의 학문적 영역을 촉진시키는데 있다.
ISL 은 다음 4가지 전제를 깔고 간다. 
지식에 관련된 이야기라기보다는 이 책이 쓰여진 전제에 대해서 기록된 내용이다.

* Many Statistical Learning methods are relevant and useful in a wide range of academic and non-academic displines, beyond just the statistical sciences. 
* Statistical learning should not be viewed as a series of black boxes.
* While it is important to know what job is performed by each cog, it is not necessary to have the skills to construct the machine inside the box!
* We presume that the reader is interested in applying statistical learning methods to real-world problems.

### 누가 읽어야 하나?
* 현대 통계학 방법론에 관심있는 모든 사람.
* 데이터 과학자, 기술자, 분석가, 금융시장분석가, 사회과학자, 사회사업가 등..
* 약간의 수학적 지식이 필요.
* R 에 대한 학습 및 지식이 필요.
* Matlab 이나 Python 에 대한 숙련도가 있으면 좋고..
* 수학적인 접근 보다는 컴퓨터 응용 관점에서 접근한다.

### 용어와 수식
* *n* : number of distinct data points, or observations in samples.
* *p* : number of variables that are available for use in making predictions.
* X[i,j] : jth variable, ith observation
* Vectors (length n) : lower case bold
* Vectors (not length n), Scalars : lower case normal font
* Random variables : capital normal font

### 데이터셋 출처와 설명
* Auto : Gas mileage, horsepower, and other information for cars.
* Boston : Housing values and other information about Boston suburbs. 
* Caravan : Information about individuals offered caravan insurance. 
* Carseats : Information about car seat sales in 400 stores.
* College : Demographic characteristics, tuition, and more for USA colleges. 
* Default : Customer default records for a credit card company.
* Hitters : Records and salaries for baseball players.
* Khan : Gene expression measurements for four cancer types.
* NCI60 : Gene expression measurements for 64 cancer cell lines.
* OJ : Sales information for Citrus Hill and Minute Maid orange juice. 
* Portfolio : Past values of financial assets, for use in portfolio allocation. 
* Smarket : Daily percentage returns for S&P 500 over a 5-year period.
* USArrests : Crime statistics per 100,000 residents in 50 states of USA.
* Wage : Income survey data for males in central Atlantic region of USA. Weekly 1,089 weekly stock market returns for 21 years.

위의 데이터는 R package, MASS Library 에 포함되어 있다.

## 정리
1장에서 본격적인 이야기가 나오는 것은 아니다.
단, 앞으로 공부해야할 내용에 대한 큰 그림을 그리고, 이야기 하고자 하는 주제를 놓치지 않으려면 숙지해두는게 좋겠다.
혼란스러울 수 있는 용어와 수식 정리 해보았는데, 소개만 읽어도 왠지 잘 이해할 수 있을까 하는 약간의 긴장감이 생겼다.
학습과정에 대해서 대략적으로 예상해 보고, 활용도에 대해서도 생각해 볼 수 있어서 유익했다.
1장 분량이 좀 많은 감도 없지 않은데, 관련분야의 사람 또는 통계분야에 관심 있는 사람이 아니라면 좀 쌩뚱 맞은 장황한 소리로만 보였을 수 있겠다는 생각도 든다.
