# 개요
hbase table 에 mr 동작을 위해서 기존에 잘 실행되던 mr 코드를 실행 대상 hadoop cluster 만 바꾸어 실행했는데 이러나고 ㅈㄹ...

# 실행환경
* spring-hadoop
* intellij IDE
* hadoop cluster : apache v2.6.0 (x15)

# Error message

```
2015-08-12 13:46:04,428 FATAL [main] org.apache.hadoop.mapreduce.v2.app.MRAppMaster: Error starting MRAppMaster
java.lang.NoClassDefFoundError: org/apache/commons/configuration/Configuration
	at org.apache.hadoop.metrics2.lib.DefaultMetricsSystem.<init>(DefaultMetricsSystem.java:38)
	at org.apache.hadoop.metrics2.lib.DefaultMetricsSystem.<clinit>(DefaultMetricsSystem.java:36)
	at org.apache.hadoop.mapreduce.v2.app.metrics.MRAppMetrics.create(MRAppMetrics.java:54)
	at org.apache.hadoop.mapreduce.v2.app.MRAppMaster.<init>(MRAppMaster.java:243)
	at org.apache.hadoop.mapreduce.v2.app.MRAppMaster.<init>(MRAppMaster.java:227)
	at org.apache.hadoop.mapreduce.v2.app.MRAppMaster.main(MRAppMaster.java:1412)
Caused by: java.lang.ClassNotFoundException: org.apache.commons.configuration.Configuration
	at java.net.URLClassLoader$1.run(URLClassLoader.java:366)
	at java.net.URLClassLoader$1.run(URLClassLoader.java:355)
	at java.security.AccessController.doPrivileged(Native Method)
	at java.net.URLClassLoader.findClass(URLClassLoader.java:354)
	at java.lang.ClassLoader.loadClass(ClassLoader.java:425)
	at sun.misc.Launcher$AppClassLoader.loadClass(Launcher.java:308)
	at java.lang.ClassLoader.loadClass(ClassLoader.java:358)
	... 6 more
2015-08-12 13:46:04,441 INFO [main] org.apache.hadoop.util.ExitUtil: Exiting with status 1
```


# 접근...
`org/apache/commons/configuration/Configuration` 클래스는 분명 *hadoop-common* 에 포함되어 있는 클래스이다. 안나올 수 없는 클래스이다. 그래서 우선은 `hadoop classpath` 명령어로 hadoop-common 관련 패키지가 있는지 확인했다.
그리고 파일이 발견되었다. 분명히 있다. ``` hadoop-common-2.6.0-sources.jar ``` 결국 구글링 들어갈 수 밖에...

* 참고 : http://stackoverflow.com/questions/14326459/hadoop-classnotfoundexception

# 기억...
spring-hadoop 을 쓰고 classpath 를 hdfs 상에 걸어서 쓰고 있었음... 
(TODO : 이거 정확히 어떻게 연결되는건지 모르는게 함정.. 알아보자.. 어딘가 설정이 걸려 있을듯..)

* 기억을 더듬어서 코드를 찾고 적당하게 jar를 복사하는 스크립트를 새로 작성

```
<beans profile="ian.dev">
    <hadoop:script id="ian.dev.kashammer.classpathJarsToHdfsScript" language="groovy" run-at-startup="true" configuration-ref="kasHadoopConfiguration">
	classpath = "/tmp/ian/dev-classpath"
	if (fsh.test(classpath)) {
	fsh.rmr(classpath)
	}
	jarsPath = "target/lib/"
	fsh.put(jarsPath, classpath)
    </hadoop:script>

    <hadoop:cache id="ian.dev.kas.dist" create-symlink="true" configuration-ref="kasHadoopConfiguration">
	<hadoop:classpath value="/tmp/ian/dev-classpath/*" />
    </hadoop:cache>
</beans>
```

* 복사 실행 코드도 끄적끄적...

```
RunWith(SpringJUnit4ClassRunner.class)
@ActiveProfiles({"ian.dev"})
@SpringApplicationConfiguration(classes = {Application.class},
        initializers = ConfigFileApplicationContextInitializer.class)
@Slf4j
public class IanSampleBatchTests {
    @Autowired
    @Qualifier("ian.dev.kashammer.classpathJarsToHdfsScript")
    HdfsScriptRunner jarRunner;
    @Test
    public void testDeployDevClasspathJars() throws Exception {
        jarRunner.call();
    }
...
```

* 파일 복사 되었나 확인하고...
``` $ hadoop fs -ls /tmp/ian/dev-classpath ``` ... 복사되었음을 확인 감격...

# ActiveProfile 에 ian.dev 추가 하고 MR 테스트 다시 실행..
(TODO : 로컬 테스트가 아니라 job을 던지는게 좀 찜찜. 미니클러스터인가 뭐시기 있다던데..)

# 결론
it works... ㅅㅂ

* 교훈 : ActiveProfile 잘 살펴보자. MR 흐름에 대해서 공부좀 더하자.
