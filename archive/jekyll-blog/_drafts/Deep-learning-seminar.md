# Deep Learning 기초

## 실습준비

* python 2.7.x
* requirements.txt

	numpy
	joblib==0.8.4
	matplotlib
	scikit-learn==0.15.2
	tabulate==0.7.5
	git+https://github.com/Theano/Theano.git@82c804c#egg=Theano==0.8.master.git
	git+https://github.com/Lasagne/Lasagne.git@7eed54b#egg=Lasagne==0.2.master.git
	git+https://github.com/dnouri/nolearn.git@1f02036#egg=nolearn==0.7.master.git


## 활용분야

* 이미지분류
* 객체 인식, 문자 인식
* 음석인식

## 기존의 Machine Learning...

* hand-crafting features
* 복잡한 수학계산, feature 추출이 어려움.

## Deep learning 이 등장하면서..

* End-to-end Learning : feature 추출이 필요없음, 기존에 사용하던 ML 전처리 과정을 모두 skip = raw data 를 그대로 넣는다.

## Neural Network

* Input Layer - Hidden Layer ... - Output Layer
* 이미지 분석에서는 하나의 픽셀이 하나의 Input Node 가 된다.

### A Single Neuron
* input - weights - transfer function - activation function - output to other neurons

### Universal approximation theorem
* 충분히 많은 hidden layer 를 가지면 어떠한 기능도 구현이 가능하다. 수학적 증명.
* Deep learning 의 문제 해결 가능성에 대한 근거가 되어 준다.

## Learning Algorithm
* while not done 
- Pick a random training case(x,y)
- (forward) run neural network on x
- (backward) modify connection

### how to modify connections?
* follow the gradient of the error w.r.t. the connections

### back propagation
* output predict 와 estimate 간의 차이를 구하고, error 수치가 기대에 미치지 못하면 back propagation 시행
* vanishing gradient problem
* 오늘날에는 hidden layer 가 100층 까지도 가능.


### Example code

	layers = [
		(inputLayer, {'shape': X.shape}),
		(DenseLayer, {'num_units':10, 'nonlinearity': tanh}),
		(DenseLayer, {'num_units':1, 'nonlinearity': identity}),
	]

	net = NeuralNet(
		layers=layers,
		regression=True,
		max_epochs = 10,
		update=sgd,
		update_learning_rate=0.01,
		verbose=1,
		...
	)



### RBMs (2006)
- Key Insights : Learn p(x), not p(y|x)


### Underfit, Overfit
* Dropout, ReLU



### 속도 문제
* 엄청난 크기의 server cluster (1000대, Google Brain)
* GPU 의 활용




### GoogleLeNet(2014)
* 22개의 layer 를 일부만 체용하여 학습하고 더 늘려서 학습하고 하는 식으로 진행





### Neural Network Types

