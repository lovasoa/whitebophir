const Minio = require("minio");

// Minio configuration
const minioClient = new Minio.Client({
    endPoint: "YourEndPointAddressHere",
    port: 9000,
    useSSL: false,
    accessKey: "YourAccessKeyHere",
    secretKey: "YourSecretKeyHere"
});
const bucketName = "server-data";

// Create default bucket if it doesn't exists
minioClient.bucketExists(bucketName, (err, bucketExists) => {
    if (bucketExists) {
        return;
    }

    console.log(`Default bucket "${bucketName}" doesn't exist, creating it...`);
    minioClient.makeBucket(bucketName, "", () => {
        console.log(`Successfully created default bucket "${bucketName}"`);
    });
});

module.exports.bucketName = bucketName;
module.exports.minioClient = minioClient;
