<?php
declare(strict_types=1);
if (!defined('NOVAX')) { http_response_code(404); exit; }
function install_site(array $data): void {
    $keyFile=__DIR__.'/install-key.php';$key=is_file($keyFile)?require $keyFile:'';
    if(!is_string($key)||strlen($key)<20)throw new UserError('Önce private/install-key.php dosyasına size özel, en az 20 karakterlik kurulum anahtarını yazın.');
    $provided=is_string($data['install_key']??null)?$data['install_key']:'';
    if(!hash_equals($key,$provided))throw new UserError('Kurulum anahtarı yanlış. Dosya Yöneticisi’ndeki private/install-key.php dosyasını kontrol edin.');
    if(version_compare(PHP_VERSION,'8.2.0','<'))throw new UserError('PHP 8.2 veya daha yeni sürüm gerekiyor.');
    foreach(['pdo_mysql','mbstring','gd'] as $ext)if(!extension_loaded($ext))throw new UserError('PHP eklentisi eksik: '.$ext.'. Hostinger PHP Configuration bölümünden etkinleştirin.');
    if(!function_exists('imagewebp'))throw new UserError('GD eklentisinde WebP desteğini etkinleştirin.');
    if(!is_writable(__DIR__) || !is_writable(NOVAX_ROOT.'/uploads'))throw new UserError('private ve uploads klasörleri PHP tarafından yazılabilir olmalı. Hosting dosya izinlerini kontrol edin; 777 izni vermeyin.');
    $username=text_value($data['admin_username']??null,100,true);
    if(!preg_match('/^[a-zA-Z0-9_.-]{3,60}$/D',$username))throw new UserError('Kullanıcı adı 3–60 harf, rakam, nokta, tire veya alt çizgiden oluşmalı.');
    $password=password_value($data['admin_password']??null,true);
    if(!is_string($data['admin_confirm']??null)||!hash_equals($password,$data['admin_confirm']))throw new UserError('Yönetici şifreleri eşleşmiyor.');
    $c=[];foreach(['db_host'=>255,'db_name'=>128,'db_user'=>128] as $field=>$max)$c[$field]=text_value($data[$field]??null,$max,true);
    if(!preg_match('/^[a-zA-Z0-9.-]+$/D',$c['db_host']))throw new UserError('Veritabanı sunucusu yalnızca bir sunucu adı olmalı; örneğin localhost.');
    foreach(['db_name','db_user'] as $field)if(!preg_match('/^[a-zA-Z0-9_-]+$/D',$c[$field]))throw new UserError('Veritabanı adı ve kullanıcı adını Hostinger panelinden aynen kopyalayın.');
    $port=filter_var($data['db_port']??3306,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>65535]]);if(!$port)throw new UserError('Geçerli veritabanı portu girin.');$c['db_port']=$port;
    $c['db_password']=is_string($data['db_password']??null)?$data['db_password']:'';if($c['db_password']==='' || strlen($c['db_password'])>512)throw new UserError('Veritabanı şifresini girin.');
    $lock=fopen(__DIR__.'/install.lock','c');if(!$lock || !flock($lock,LOCK_EX|LOCK_NB))throw new UserError('Başka bir kurulum sürüyor. Biraz bekleyin.',409);
    $db=null;$created=[];$pending=__DIR__.'/config-'.bin2hex(random_bytes(8)).'.php';
    try {
        if(is_installed())throw new UserError('Kurulum daha önce tamamlanmış.',409);
        $db=connect_db($c);
        $tables=$db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach($tables as $table)if(str_starts_with($table,'nv_'))throw new UserError('Bu veritabanında Novax tabloları zaten var. Yeni ve boş bir veritabanı kullanın; mevcut tablolar silinmedi.');
        $schema=[
          'nv_settings'=>'id TINYINT UNSIGNED PRIMARY KEY, value LONGTEXT NOT NULL',
          'nv_admin'=>'id TINYINT UNSIGNED PRIMARY KEY, username VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 1',
          'nv_services'=>'id VARCHAR(36) PRIMARY KEY, title VARCHAR(120) NOT NULL, description TEXT NOT NULL, available TINYINT UNSIGNED NOT NULL DEFAULT 1, position BIGINT NOT NULL DEFAULT 0',
          'nv_projects'=>'id VARCHAR(36) PRIMARY KEY, title VARCHAR(120) NOT NULL, category VARCHAR(80) NOT NULL, description TEXT NOT NULL, image VARCHAR(255) NOT NULL, demo TINYINT UNSIGNED NOT NULL DEFAULT 0, created BIGINT NOT NULL',
          'nv_attempts'=>'bucket CHAR(64) PRIMARY KEY, started BIGINT NOT NULL, hits INT UNSIGNED NOT NULL'
        ];
        foreach($schema as $table=>$columns){$db->exec('CREATE TABLE '.$table.' ('.$columns.') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');$created[]=$table;}
        $seed=json_decode(file_get_contents(__DIR__.'/default-content.json'),true,512,JSON_THROW_ON_ERROR);
        $db->beginTransaction();
        $q=$db->prepare('INSERT INTO nv_settings VALUES(1,?)');$q->execute([json_encode($seed['settings'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
        $q=$db->prepare('INSERT INTO nv_admin (id,username,password) VALUES(1,?,?)');$q->execute([$username,password_hash($password,PASSWORD_DEFAULT)]);
        $q=$db->prepare('INSERT INTO nv_services VALUES(?,?,?,?,?)');foreach($seed['services'] as $i=>$s)$q->execute([$s['id'],$s['title'],$s['description'],$s['available'],$i]);
        $q=$db->prepare('INSERT INTO nv_projects VALUES(?,?,?,?,?,?,?)');foreach($seed['projects'] as $p)$q->execute([$p['id'],$p['title'],$p['category'],$p['description'],$p['image'],$p['demo'],$p['created']]);
        $configText="<?php\nif (!defined('NOVAX')) { http_response_code(404); exit; }\nreturn ".var_export($c,true).";\n";
        if(file_put_contents($pending,$configText,LOCK_EX)===false)throw new RuntimeException('Config storage unavailable');chmod($pending,0600);
        $db->commit();
        if(!rename($pending,NOVAX_CONFIG))throw new RuntimeException('Config publish failed');
        @unlink($keyFile);$_SESSION=[];session_regenerate_id(true);
    }catch(Throwable $e){
        if($db){if($db->inTransaction())$db->rollBack();foreach(array_reverse($created) as $table){try{$db->exec('DROP TABLE '.$table);}catch(Throwable){}}}
        @unlink($pending);throw $e;
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
