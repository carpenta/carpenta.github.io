# 개요
Hammer4Neo 에 작성된 정적 수집 MR 수행시에 유의 점..

# collector-job.xml
job 수행 설정을 가지고 있는 hammer4mr-proto/collection/resources/batch/jobs/collector-job.xml 을 확인해보면
정적 수집의 경우 hadoopConfiguration 을 ref 로 설정하고 있는데...
이렇게 되면 전역설정한 search-hammer-analyzer 클러스터를 대상으로 사용하게 된다.
kasHbase 같이 다른 클러스터에 던지고 싶으면 이 설정을 하드 코딩해야 하는 불편함이 있다.
