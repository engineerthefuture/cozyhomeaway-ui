// API gateway settings (set via environment variables at build/deploy time)
let api = "__CONTACTFORM_API__";
let key = "__CONTACTFORM_KEY__";

// Validate email address
function validateEmail() {
    var isValid = true;
    var emailRegex = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,6})?$/;
    var field = document.getElementById("email");
    var validationDiv = document.getElementById("emailValidation");
    var checkMarkSpan = document.getElementById("emailCheck");
    if (field == undefined || field.value == "" || field.value == undefined || !emailRegex.test(field.value)) {
        validationDiv.innerHTML = "<h6 style=\"color:red;\">You must provide your email address.</h6>";
        checkMarkSpan.innerHTML = "<h6 style=\"color:red;\">&nbsp;&nbsp;X</h6>";
        isValid = false;
    } else {
        validationDiv.innerHTML = "";
        checkMarkSpan.innerHTML = "<h6 style=\"color:green;\">&nbsp;&nbsp;&#10003;</h6>";
    }

    return isValid;
}

// Validate name
function validateName() {
    var isValid = true;
    var nameRegex = /^[a-zA-Z]+ [a-zA-Z]+$/;
    var field = document.getElementById("name");
    var validationDiv = document.getElementById("nameValidation");
    var checkMarkSpan = document.getElementById("nameCheck");
    if (field == undefined || field.value == "" || field.value == undefined || field.value.length < 3) {
        validationDiv.innerHTML = "<h6 style=\"color:red;\">You must provide your name.</h6>";
        checkMarkSpan.innerHTML = "<h6 style=\"color:red;\">&nbsp;&nbsp;X</h6>";
        isValid = false;
    } else {
        validationDiv.innerHTML = "";
        checkMarkSpan.innerHTML = "<h6 style=\"color:green;\">&nbsp;&nbsp;&#10003;</h6>";
    }

    return isValid;
}

// Validate message
function validateMessage() {
    var isValid = true;
    var nameRegex = /^[a-zA-Z]+ [a-zA-Z]+$/;
    var field = document.getElementById("message");
    var validationDiv = document.getElementById("messageValidation");
    var checkMarkSpan = document.getElementById("messageCheck");
    if (field == undefined || field.value == "" || field.value == undefined || field.value.length < 3) {
        validationDiv.innerHTML = "<h6 style=\"color:red;\">You must provide a message.</h6>";
        checkMarkSpan.innerHTML = "<h6 style=\"color:red;\">&nbsp;&nbsp;X</h6>";
        isValid = false;
    } else {
        validationDiv.innerHTML = "";
        checkMarkSpan.innerHTML = "<h6 style=\"color:green;\">&nbsp;&nbsp;&#10003;</h6>";
    }

    return isValid;
}

// Submit the contact from
function submitForm(e) {
    e.preventDefault();

    // Run each validation
    validateName();
    validateEmail();
    validateMessage();

    // Validate Recaptcha
    grecaptcha.ready(function() {
        grecaptcha.execute('RECAPTCHA_CLIENT_KEY', { action: 'submit' }).then(function(token) {
            try {
                // Set values
                api = api + "?token=" + token;

                // Construct an HTTP request
                var rxhr = new XMLHttpRequest();
                rxhr.open("GET", api, true);
                rxhr.setRequestHeader("X-Api-Key", key);

                // Send the request
                rxhr.send();

                // Callback function
                rxhr.onloadend = (response) => {
                    // Parse the response object and grab the message

                    if (rxhr.responseText.length > 0 && rxhr.status === 200) {
                        console.log("Recaptcha response: " + rxhr.responseText);
                        // Determine if all the fields are validated
                        if (validateName() &&
                            validateEmail() &&
                            validateMessage()) {
                            console.log("All validated ok.");

                            var message = $("#message").val();
                            var email = $("#email").val();
                            var name = $("#name").val();
                            var data = {
                                name: name,
                                email: email,
                                message: message
                            };

                            // Prepare the JSON object
                            var requestObject = JSON.stringify(data);

                            // Construct request
                            var xhr = new XMLHttpRequest();
                            xhr.open("POST", api, true);
                            xhr.setRequestHeader("Content-Type", "application/json; charset=UTF-8");
                            xhr.setRequestHeader("X-Api-Key", key);

                            // Send the collected data as JSON
                            document.getElementById("form-div").style.display = "none";
                            xhr.send(requestObject);

                            // Callback function
                            xhr.onloadend = (response) => {
                                // Parse the response object and grab the message
                                if (xhr.responseText.length > 0) {
                                    console.log("Response: " + xhr.responseText);
                                }

                                if (xhr.status === 200) {
                                    // The form submission was successful
                                    document.getElementById("response-div").innerHTML = "<h5 style=\"color:green;\">Message successfully sent.</h5>";
                                    xhr.abort();
                                    return true;
                                } else {
                                    // The form submission failed
                                    document.getElementById("response-div").innerHTML = "<h5 style=\"color:red;\">Something went wrong, and I apologize for the inconvenience. Please send an email to <a href='mailto:support@cozyhomeaway.com'>support@cozyhomeaway.com</a> to get in touch.</h5>";
                                    document.getElementById("form-div").style.display = "block";
                                    console.error(xhr.responseText);
                                    xhr.abort();
                                    return false;
                                }
                            };
                        } else {
                            return false;
                        }
                    } else {
                        console.error(rxhr.responseText);
                        rxhr.abort();
                        document.getElementById("recaptchaValidation").innerHTML = "<h5 style=\"color:red;\">Recaptcha validation error.</h5>";
                        return false;
                    }
                };
            } catch (err) {
                console.log("Error: " + err.message);
            }
        });
    });
}