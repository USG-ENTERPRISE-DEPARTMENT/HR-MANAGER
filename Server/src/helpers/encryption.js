const crypto = require('crypto');

/**
 * AES-256/CBC/PKCS5Padding payload crypto with a random IV per message.
 *
 * Wire format (Base64):  IV(16 bytes) || CIPHERTEXT
 */
class PayloadCrypto {

    static ALGORITHM = 'aes-256-cbc';
    static AES_KEY   = '1c9e7b2d5406a1f7b204683f8ae3c9de'; // 32 bytes UTF-8

    static encrypt(plainText) {
        const iv = crypto.randomBytes(16);

        const cipher = crypto.createCipheriv(
            PayloadCrypto.ALGORITHM,
            Buffer.from(PayloadCrypto.AES_KEY, 'utf8'),
            iv
        );

        const cipherText = Buffer.concat([
            cipher.update(plainText, 'utf8'),
            cipher.final()
        ]);

        const combined = Buffer.concat([iv, cipherText]);
        return combined.toString('base64');
    }

    static decrypt(base64) {
        const combined = Buffer.from(base64, 'base64');

        if (combined.length < 17) {
            throw new Error('Ciphertext too short');
        }

        const iv         = combined.subarray(0, 16);
        const cipherText = combined.subarray(16);

        const decipher = crypto.createDecipheriv(
            PayloadCrypto.ALGORITHM,
            Buffer.from(PayloadCrypto.AES_KEY, 'utf8'),
            iv
        );

        const decrypted = Buffer.concat([
            decipher.update(cipherText),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    }

    static encryptFormUrl(plainText) {
        const iv = crypto.randomBytes(16);

        const cipher = crypto.createCipheriv(
            PayloadCrypto.ALGORITHM,
            Buffer.from(PayloadCrypto.AES_KEY, 'utf8'),
            iv
        );

        const cipherText = Buffer.concat([
            cipher.update(plainText, 'utf8'),
            cipher.final()
        ]);

        const combined = Buffer.concat([iv, cipherText]);
        return combined.toString('base64url');
    }

    static decryptFromUrl(base64Url) {
        const combined = Buffer.from(base64Url, 'base64url');

        if (combined.length < 17) {
            throw new Error('Ciphertext too short');
        }

        const iv         = combined.subarray(0, 16);
        const cipherText = combined.subarray(16);

        const decipher = crypto.createDecipheriv(
            PayloadCrypto.ALGORITHM,
            Buffer.from(PayloadCrypto.AES_KEY, 'utf8'),
            iv
        );

        const decrypted = Buffer.concat([
            decipher.update(cipherText),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    }
}

module.exports = PayloadCrypto;