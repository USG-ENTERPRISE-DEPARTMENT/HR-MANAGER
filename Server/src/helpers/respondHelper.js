/**
 * Standardised JSON response shapes.
 * Keeps status codes + body format consistent across every endpoint.
 */
const respond = {
    ok:      (res, message, data)  => res.status(200).json({ status: '200', message, data }),
    created: (res, message, data)  => res.status(201).json({ status: '201', message, data }),
    badReq:  (res, message)        => res.status(400).json({ status: '400', message }),
    forbidden: (res, message)       => res.status(403).json({ status: '403', message }),
    notFound: (res, message)        => res.status(404).json({ status: '404', message }),
    conflict: (res, message)        => res.status(409).json({ status: '409', message }),
    error:    (res, message, err)   => {
        console.error(message, err);
        return res.status(500).json({ status: '500', message: `${message}: ${err.message}` });
    },
};


module.exports = respond;